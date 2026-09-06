"use client";

import { supabase } from "@/lib/supabase/client";
import { assessWorksheetMaterial } from "@/lib/worksheet.mjs";

export type ExtractedItem = {
  position: number;
  label: string;
  text: string;
  /** 1 to 5, or null when nothing has judged this exercise yet. */
  difficulty: number | null;
  uncertain: boolean;
};

export type QuotaUsage = { usedThisMonth: number; perMonth: number };

export type ExtractOutcome =
  | {
      ok: true;
      items: ExtractedItem[];
      language: string;
      inputTruncated: boolean;
      outputTruncated: boolean;
      usage?: QuotaUsage;
    }
  | {
      ok: false;
      /** Always a sentence the student can act on, never a status code. */
      message: string;
      code: string;
    };

export type RateOutcome =
  | { ok: true; ratings: Map<number, number>; rated: number }
  | { ok: false; code: string; message: string };

/**
 * How long a request may go without a byte arriving before it is given up on.
 *
 * This exists because of a failure `fetch` does not have an error for: a mobile
 * connection that stops delivering packets without closing. The promise simply
 * never settles, and the screen sits on a spinner forever with nothing to
 * retry. A timer is the only thing that turns that into a state.
 */
const IDLE_TIMEOUT_MS = 60_000;
const RETRIES = 2;

function endpoint(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return url ? `${url}/functions/v1/ai-proxy` : null;
}

type Failure = { ok: false; code: string; message: string };
type Payload = Record<string, unknown> & { ok?: boolean; code?: string; message?: string };

const NOT_CONFIGURED: Failure = {
  ok: false,
  code: "not_configured",
  message: "האפליקציה עדיין לא חוברה לשרת. אפשר להוסיף תרגילים ידנית.",
};

/**
 * One request to the proxy, with the watchdog and the retry policy both tasks
 * share.
 *
 * Never throws. Every path out is either a payload or a sentence, because both
 * callers do the same thing with a failure: carry on without the model.
 */
async function call(body: Record<string, unknown>): Promise<Payload | Failure> {
  const client = supabase();
  const url = endpoint();
  if (!client || !url) return NOT_CONFIGURED;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);

    try {
      // Read the session on every attempt rather than once. A long extraction
      // can outlive an access token, and the retry that follows a 401 must not
      // carry the same dead one.
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        clearTimeout(timer);
        return { ok: false, code: "signed_out", message: "צריך להתחבר כדי לסרוק דף." };
      }

      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        },
        body: JSON.stringify(body),
      });
      clearTimeout(timer);

      const payload = (await res.json().catch(() => null)) as Payload | null;
      if (res.ok && payload?.ok) return payload;

      // Being over quota, signed out, or malformed is a final answer. A retry
      // makes none of them truer and spends another slot proving it.
      if (res.status === 429 || res.status === 401 || res.status === 400) {
        return {
          ok: false,
          code: payload?.code ?? String(res.status),
          message: payload?.message ?? "לא הצלחנו לקרוא את הדף. אפשר להוסיף תרגילים ידנית.",
        };
      }

      if (attempt < RETRIES) {
        await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
        continue;
      }
      return {
        ok: false,
        code: payload?.code ?? "server_error",
        message: payload?.message ?? "השירות לא זמין כרגע. אפשר להוסיף תרגילים ידנית.",
      };
    } catch (err) {
      clearTimeout(timer);
      console.error("ai-proxy call failed:", err);
      if (attempt < RETRIES) {
        await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
        continue;
      }
      return {
        ok: false,
        code: "network",
        message: "אין חיבור יציב. בדוק את הרשת, או הוסף תרגילים ידנית.",
      };
    }
  }

  // Unreachable: the loop returns on every path. Kept so the function has one
  // shape rather than an implicit undefined.
  return { ok: false, code: "unknown", message: "משהו השתבש. אפשר להוסיף תרגילים ידנית." };
}

/**
 * Read the exercises off a page.
 *
 * The gate runs first, in the browser, and it is not a security boundary — the
 * server checks quota regardless. It is there so a photograph that came back as
 * forty characters of noise costs a sentence of explanation instead of a call.
 *
 * Never throws, and never returns half an answer. Every path out of here is
 * either a list or a sentence, because the caller's next move is the same
 * either way: open the correction screen.
 */
export async function extractExercises(text: string): Promise<ExtractOutcome> {
  const unsuitable = assessWorksheetMaterial(text);
  if (unsuitable) {
    return { ok: false, code: unsuitable.code, message: `${unsuitable.title}. ${unsuitable.fix}` };
  }

  const payload = await call({ task: "extract", text });
  if (payload.ok !== true) return payload as Failure;

  return {
    ok: true,
    items: (payload.items as ExtractedItem[]) ?? [],
    language: (payload.language as string) ?? "",
    inputTruncated: Boolean(payload.inputTruncated),
    outputTruncated: Boolean(payload.outputTruncated),
    usage: payload.usage as QuotaUsage | undefined,
  };
}

/**
 * Rate exercises the offline splitter already found.
 *
 * The cheap call, and the one that runs on the ordinary page. It sends labels
 * and truncated bodies, and gets back one number each — no text comes back, so
 * there is nowhere for a model to rewrite a student's homework even if it tried.
 *
 * Failing is not a problem worth showing anyone: an unrated list still ticks
 * off, and the ordering falls back to page order on its own. So the caller
 * treats a failure here as "no ratings", not as an error.
 */
export async function rateExercises(
  items: { label: string; text: string }[],
): Promise<RateOutcome> {
  if (items.length < 2) {
    return { ok: false, code: "too_few_items", message: "אין מה לדרג." };
  }

  const payload = await call({
    task: "rate",
    items: items.map(({ label, text }) => ({ label, text })),
  });
  if (payload.ok !== true) return payload as Failure;

  const rows = (payload.ratings as { n: number; difficulty: number }[]) ?? [];
  return {
    ok: true,
    ratings: new Map(rows.map((r) => [r.n, r.difficulty])),
    rated: Number(payload.rated ?? rows.length),
  };
}
