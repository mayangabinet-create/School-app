/**
 * Every decision this product makes about cost, quota and model choice.
 *
 * The one rule for this file: no I/O. No fetch, no Deno, no Supabase, no
 * `window`, no `process`. It is arithmetic and constants, so the tests can
 * import the file that actually ships instead of a copy that drifts away from
 * it, and so the Edge Function and the browser can never disagree about what a
 * user is allowed.
 *
 * The previous project (AI Learning Path) learned this the expensive way: its
 * "free work" path — tutor and feedback calls — was bounded by a daily counter
 * and nothing else, so a feature whose intended worst case was about $17/month
 * per user had a real ceiling near $180. Here every AI-calling feature gets a
 * MONTHLY quota, written before the first call was made. The daily number
 * below is a safety net against a runaway client loop, not a business limit.
 */

// ---------------------------------------------------------------- models

// Named here and nowhere else. Deliberately NOT shown to the user anywhere in
// the product: naming a model in a price list turns a row that should be free
// to tune for speed and cost into a promise, means nothing to anyone who does
// not follow model releases, and goes stale on the next rename.
export const HAIKU = "claude-haiku-4-5";
export const SONNET = "claude-sonnet-5";

// ---------------------------------------------------------------- tasks

// Two tasks, and the split between them is the whole cost model.
//
// `split.mjs` finds the exercise boundaries offline, for free, by reading the
// numbering the worksheet already prints on itself. It handles most pages. So
// `extract` — the expensive call that reads a whole page and writes every
// exercise out — runs only when that fails: an unnumbered page, or a list the
// student says is wrong.
//
// `rate` is what runs on the common path instead. It is handed the exercise
// list the splitter already produced and asked only how hard each one is,
// which is a judgement rather than a transcription: short input, a few numbers
// out, roughly a tenth the cost of `extract`. The model does the part a regular
// expression cannot, and nothing else.
//
// Explaining exercises is still not here and should not be: that is the other
// product's job and it costs real money per item. Any third task needs its own
// row in QUOTAS below before it is allowed to make a call.
export const KNOWN_TASKS = new Set(["extract", "rate"]);

// ---------------------------------------------------------------- quotas

/**
 * One row per AI-calling feature. `perMonth` is the business limit; `perDay`
 * is the runaway-loop backstop and is deliberately much smaller than
 * perMonth / 28, because no honest user photographs ten worksheets a day but a
 * broken retry loop does it in a minute.
 *
 * `maxInputChars` bounds what we are willing to pay to read; `maxOutputTokens`
 * bounds what we are willing to pay to write. Both are enforced server-side.
 */
export const QUOTAS = {
  extract: {
    perMonth: 25,
    perDay: 6,
    maxInputChars: 20_000,
    maxOutputTokens: 4_000,
    model: HAIKU,
  },
  rate: {
    // A higher monthly allowance than `extract` because this is the call that
    // runs on the ordinary path, and a much smaller one per call: the input is
    // a list of exercises somebody already extracted, and the output is one
    // number each.
    perMonth: 60,
    perDay: 15,
    maxInputChars: 8_000,
    maxOutputTokens: 600,
    model: HAIKU,
  },
};

// The product is free. This constant exists so that stays a decision recorded
// in one place rather than an assumption spread through the code: when a paid
// tier arrives, `planFor()` gains a real body and every caller already routes
// through it.
export const FREE_PLAN = "free";

export function quotaFor(task) {
  return QUOTAS[task] || null;
}

export function planFor(_planName) {
  return FREE_PLAN;
}

export function modelFor(task) {
  return quotaFor(task)?.model || HAIKU;
}

/**
 * The single source of truth for every quota number a person reads on screen.
 *
 * The previous project shortened its trial from 14 days to 3 in a migration,
 * updated the landing page, and left the signup modal promising "Fourteen days
 * free" — in the sentence someone reads at the exact moment they create an
 * account. The fix is not vigilance, it is having one place to change.
 */
export function quotaSummary(task) {
  const q = quotaFor(task);
  if (!q) return null;
  return { task, perMonth: q.perMonth, perDay: q.perDay };
}

// ---------------------------------------------------------------- clamping

export const CHARS_PER_TOKEN = 4;

// How far back to look for a whitespace boundary before giving up and cutting
// mid-word. An absolute distance, deliberately, not a fraction of the budget:
// a fraction looks reasonable at 200 characters and throws away two thousand
// at 20,000. Nothing legitimate needs a longer look-back than this, and a
// document with no whitespace at all inside 200 characters is not prose the
// boundary would have helped anyway.
export const BOUNDARY_LOOKBACK = 200;

/**
 * Cut text to a character budget on a whitespace boundary when there is one
 * nearby, so the model is never handed half a word as its last token. Returns
 * the text unchanged when it already fits — callers rely on that to detect
 * whether anything was dropped.
 */
export function clampText(text, budget) {
  const s = String(text || "");
  if (budget <= 0) return "";
  if (s.length <= budget) return s;
  const cut = s.slice(0, budget);
  const at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  return at >= budget - BOUNDARY_LOOKBACK && at > 0 ? cut.slice(0, at) : cut;
}

/**
 * What the server will actually send for a task, and whether it had to drop
 * anything. The caller reports `truncated` to the user rather than silently
 * building a checklist from the first half of a worksheet — a person who
 * photographed two pages needs to know only one of them was read.
 */
export function prepareInput(task, text) {
  const q = quotaFor(task);
  if (!q) return { text: "", truncated: false, ok: false };
  const clamped = clampText(text, q.maxInputChars);
  return {
    text: clamped,
    truncated: clamped.length < String(text || "").length,
    ok: clamped.length > 0,
  };
}

export function maxOutputTokens(task) {
  return quotaFor(task)?.maxOutputTokens || 1_000;
}

// ---------------------------------------------------------------- metering

/**
 * Cost of one call, in whole thousandths of a US cent, from the token counts
 * the API reports. Integer arithmetic on purpose: this number is summed across
 * every call a user ever makes, and floating-point cents accumulate error.
 *
 * Prices are per million tokens, in thousandths of a cent:
 *   Haiku 4.5   $1.00 in / $5.00 out per Mtok
 *   Sonnet 5    $3.00 in / $15.00 out per Mtok
 */
const PRICE_MICROCENTS_PER_MTOK = {
  [HAIKU]: { input: 100_000, output: 500_000 },
  [SONNET]: { input: 300_000, output: 1_500_000 },
};

export function callCost(model, usage) {
  const p = PRICE_MICROCENTS_PER_MTOK[model];
  if (!p) return 0;
  const inTok = Math.max(0, Number(usage?.input_tokens) || 0);
  const outTok = Math.max(0, Number(usage?.output_tokens) || 0);
  return Math.round((inTok * p.input + outTok * p.output) / 1_000_000);
}

// ---------------------------------------------------------------- validation

/**
 * Everything the Edge Function must agree to before it spends a cent. Returns
 * null when the request is fine, or a {status, code, message} to send back.
 *
 * The browser carries a copy of these limits to shape its UI, but this is the
 * copy that decides, because a modified client can send any request it likes.
 */
export function validateRequest(body) {
  const task = body?.task;
  if (!KNOWN_TASKS.has(task)) {
    return { status: 400, code: "unknown_task", message: "Unknown task." };
  }

  if (task === "rate") {
    const items = body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return { status: 400, code: "empty_input", message: "Nothing to rate." };
    }
    // One exercise is not a list worth a call, and rating it would tell the
    // ordering nothing it does not already know.
    if (items.length < 2) {
      return { status: 400, code: "too_few_items", message: "Nothing to compare." };
    }
    return null;
  }

  const text = String(body?.text || "");
  if (!text.trim()) {
    return { status: 400, code: "empty_input", message: "Nothing to read." };
  }
  return null;
}
