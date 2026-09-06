/**
 * The only path from this product to a model.
 *
 * I/O only. Every decision — which model, what a task may spend, how much of
 * the page is read, what the reply is allowed to look like — lives in
 * ../_shared/policy.mjs and ../_shared/worksheet.mjs, which have no I/O in
 * them and are imported unchanged by the browser and by `node --test`. When
 * a rule needs to change it changes in one file, and the tests run the file
 * that ships rather than a copy of it.
 *
 * The browser also holds those limits, but only to shape its own UI. This is
 * the copy that decides, because a modified client can send any request it
 * likes.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  KNOWN_TASKS,
  callCost,
  maxOutputTokens,
  modelFor,
  prepareInput,
  quotaFor,
  validateRequest,
} from "../_shared/policy.mjs";
import { buildExtractPrompt, normaliseItems } from "../_shared/worksheet.mjs";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// A generous ceiling on one call, not a latency target. Extraction is a single
// non-streaming request, so the failure this guards against is the one a
// promise never rejects on: a mobile connection that stops delivering packets
// without closing. `fetch` will wait forever; this will not.
const CALL_TIMEOUT_MS = 90_000;

const CORS = {
  "access-control-allow-origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "access-control-allow-headers": "authorization, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
    console.error("ai-proxy is missing environment configuration");
    return json({ error: "server_misconfigured" }, 500);
  }

  // ------------------------------------------------------------- who
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized", code: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) {
    return json({
      error: "unauthorized",
      code: "unauthorized",
      message: "החיבור פג. התחבר שוב.",
    }, 401);
  }

  // ------------------------------------------------------------- what
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request", code: "bad_request" }, 400);
  }

  const rejection = validateRequest(body);
  if (rejection) {
    return json({ error: rejection.code, code: rejection.code, message: rejection.message },
      rejection.status);
  }

  const task = String(body.task);
  const quota = quotaFor(task);
  if (!quota) {
    // Unreachable while validateRequest and QUOTAS agree, which a test
    // enforces. Kept because "no quota row" must never mean "no limit".
    return json({ error: "no_quota_configured", code: "no_quota_configured" }, 500);
  }

  const input = prepareInput(task, body.text);
  if (!input.ok) return json({ error: "empty_input", code: "empty_input" }, 400);

  // ------------------------------------------------------------- may they
  const { data: verdict, error: quotaErr } = await admin.rpc("consume_ai_quota", {
    p_user_id: user.id,
    p_task: task,
    p_per_month: quota.perMonth,
    p_per_day: quota.perDay,
    p_model: modelFor(task),
  });

  if (quotaErr || !verdict) {
    console.error("consume_ai_quota failed:", quotaErr);
    return json({ error: "quota_check_failed", code: "quota_check_failed" }, 500);
  }

  if (!verdict.ok) {
    // The message names the limit that was hit and when it lifts, because
    // "limit reached" is not something a person can act on.
    const message = verdict.code === "day_quota"
      ? `הגעת ל־${quota.perDay} סריקות היום. אפשר להמשיך מחר, או להוסיף תרגילים ידנית.`
      : `ניצלת את כל ${quota.perMonth} הסריקות של החודש. אפשר להוסיף תרגילים ידנית בינתיים.`;
    return json({ error: verdict.code, code: verdict.code, message, usage: verdict }, 429);
  }

  const usageId = verdict.usage_id as string;
  const model = modelFor(task);

  // ------------------------------------------------------------- the call
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  let reply: Response;
  try {
    reply = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens(task),
        messages: [{ role: "user", content: buildExtractPrompt(input.text) }],
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    // Nothing reached the model, so nothing was paid for and the reservation
    // is given back. `release_ai_quota` refuses to delete a row that already
    // has tokens on it, so this can never refund a call that actually ran.
    await admin.rpc("release_ai_quota", { p_usage_id: usageId });
    console.error("upstream unreachable:", err);
    return json({
      error: "upstream_unreachable",
      code: "upstream_unreachable",
      message: "לא הצלחנו להתחבר. בדוק את החיבור ונסה שוב.",
    }, 503);
  }
  clearTimeout(timer);

  if (!reply.ok) {
    const detail = await reply.text().catch(() => "");
    console.error("upstream error:", reply.status, detail.slice(0, 500));

    // A 429 or a 5xx upstream is the provider's problem, not the student's
    // budget: the reservation goes back and they can try again. A 4xx is our
    // own malformed request, and that one stays spent so a broken client
    // cannot retry it in a loop for free.
    if (reply.status === 429 || reply.status >= 500) {
      await admin.rpc("release_ai_quota", { p_usage_id: usageId });
      return json({
        error: "upstream_busy",
        code: "upstream_busy",
        message: "השירות עמוס כרגע. נסה שוב בעוד רגע.",
      }, 503);
    }

    await admin.rpc("record_ai_usage", {
      p_usage_id: usageId, p_input: 0, p_output: 0, p_cost: 0, p_ok: false,
    });
    return json({ error: "upstream_rejected", code: "upstream_rejected" }, 502);
  }

  const payload = await reply.json().catch(() => null);
  const usage = payload?.usage ?? {};

  // Metered whether or not the reply turns out to be usable. Tokens we were
  // billed for are tokens we record — the whole reason this table exists is
  // that cost per user should be observable before it is a surprise.
  await admin.rpc("record_ai_usage", {
    p_usage_id: usageId,
    p_input: usage.input_tokens ?? 0,
    p_output: usage.output_tokens ?? 0,
    p_cost: callCost(model, usage),
    p_ok: true,
  });

  const text = (payload?.content ?? [])
    .filter((p: { type?: string }) => p?.type === "text")
    .map((p: { text?: string }) => p.text ?? "")
    .join("");

  // Normalised here rather than in the browser, with the same module the
  // browser would have used. A malformed reply becomes an empty list, and an
  // empty list is the client's signal to open manual entry — never a broken
  // screen, and never a thrown error the student sees.
  const result = normaliseItems(text);

  return json({
    ok: true,
    items: result.items,
    language: result.language,
    // The page was longer than the read budget, so some of it was never sent.
    // The student is told, rather than quietly given half a worksheet.
    inputTruncated: input.truncated,
    // The model ran out of room mid-list, so the tail is missing even though
    // the page was fully read. A different problem with the same symptom, and
    // the correction screen says which one happened.
    outputTruncated: payload?.stop_reason === "max_tokens",
    usage: { usedThisMonth: verdict.used_this_month, perMonth: quota.perMonth },
  });
});

// Referenced so the import is not dropped as unused by a bundler; also the
// cheapest possible assertion that this function and policy.mjs agree about
// which tasks exist.
if (!KNOWN_TASKS.has("extract")) throw new Error("policy.mjs no longer defines the extract task");
