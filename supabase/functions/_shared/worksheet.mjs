/**
 * Turning a photographed or uploaded worksheet into a list of exercises.
 *
 * The hard half of this was already solved and tested in the previous project
 * (AI Learning Path): the prompt that enumerates exercises without merging,
 * skipping or inventing any, and the suitability gate that — unlike the one
 * for prose study material — does not reject a page that is mostly digits.
 * Both are ported here. What changed is only what an exercise BECOMES: there,
 * a generated lesson; here, a checklist row with a done state and nothing else.
 *
 * No I/O in this file. Same rule as policy.mjs, same reason.
 */

// ---------------------------------------------------------------- statistics

/**
 * Arithmetic over the text, and nothing else. Nothing here judges the subject
 * — a worksheet about anything at all passes.
 */
export function materialStats(text) {
  const source = String(text || "").trim();
  const letters = (source.match(/\p{L}/gu) || []).length;
  const digits = (source.match(/\p{Nd}/gu) || []).length;
  const words = source.split(/\s+/).filter(Boolean);
  const real = words.filter((w) => /\p{L}{3,}/u.test(w));
  const distinct = new Set(
    real.map((w) => w.toLowerCase().replace(/\p{P}/gu, "")),
  ).size;
  return {
    chars: source.length,
    words: words.length,
    realWords: real.length,
    letterShare: source.length ? letters / source.length : 0,
    digitShare: source.length ? digits / source.length : 0,
    vocabulary: real.length ? distinct / real.length : 0,
  };
}

// ---------------------------------------------------------------- the gate

/**
 * Deliberately lighter than a gate for prose.
 *
 * The old app's `assessMaterial()` rejects text that is mostly digits and
 * symbols with no full sentences — which is an exact description of a page of
 * exercises. "1. Solve 2x+5=13" is three real words, no sentence, and mostly
 * symbols, and it is precisely what this app exists to read. So the
 * shape-of-prose checks are dropped and only the two that still mean something
 * are kept: nothing was pasted, and the same line is not repeated down the page
 * (a scan whose OCR got stuck on one row).
 *
 * Returns null when the material is fine, or the reason it is not. Every reason
 * names what was actually seen, because "this file is not suitable" is not
 * something a person can act on.
 */
export const WORKSHEET_MIN_CHARS = 150;

export function assessWorksheetMaterial(text) {
  const st = materialStats(text);

  if (st.chars < WORKSHEET_MIN_CHARS) {
    return {
      code: "too-short",
      title: "לא הצלחנו לקרוא מספיק מהדף",
      detail: `יצאו מזה בערך ${st.chars} תווים בלבד. אולי הצילום מטושטש, או שרק חלק מהדף נכנס לתמונה.`,
      fix: "צלם שוב באור טוב, עם כל הדף בתוך המסגרת — או הקלד את התרגילים ידנית.",
      stats: st,
    };
  }

  if (st.realWords > 400 && st.vocabulary < 0.12) {
    return {
      code: "repetitive",
      title: "אותה שורה חוזרת שוב ושוב",
      detail: `רק כ־${Math.round(st.vocabulary * 100)} אחוז מהמילים שונות זו מזו. זה בדרך כלל סימן שהסריקה נתקעה על שורה אחת.`,
      fix: "נסה לצלם שוב, או להקליד את התרגילים ידנית.",
      stats: st,
    };
  }

  return null;
}

// ---------------------------------------------------------------- difficulty

/**
 * One scale, defined once, and the only place these five numbers mean
 * anything.
 *
 * The prompt is generated from it, so the model can never be asked for a level
 * the app cannot render, and adding or renaming a band is one edit here rather
 * than an edit in the prompt plus an edit in the UI plus a mismatch that shows
 * up as a blank badge three weeks later.
 *
 * The wording matters as much as the numbers. Nothing on this scale says a
 * student is bad at something: the top band is "takes a while", not "hard for
 * you". A checklist that grades the person instead of the work is a checklist
 * they stop opening.
 */
export const DIFFICULTY = {
  1: { label: "מהיר", hint: "שורה אחת, בלי שלבים" },
  2: { label: "קל", hint: "שלב או שניים" },
  3: { label: "רגיל", hint: "כמה שלבים" },
  4: { label: "מורכב", hint: "צריך לשבת עליו" },
  5: { label: "לוקח זמן", hint: "כמה חלקים או הוכחה" },
};

export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 5;

/** A level the app can actually render, or null. Never a silent 3. */
export function cleanDifficulty(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < DIFFICULTY_MIN || n > DIFFICULTY_MAX) return null;
  return n;
}

/** The catalogue the prompts show the model, generated from the scale above. */
export function difficultyCatalogue() {
  return Object.entries(DIFFICULTY)
    .map(([level, { label, hint }]) => `  ${level} = ${label} (${hint})`)
    .join("\n");
}

// ---------------------------------------------------------------- the prompt

/**
 * Ported from `buildWorksheetPlanPrompt()` in the old app, with the output
 * schema replaced.
 *
 * There is no "list 10-20 of them" here, on purpose: the count is whatever the
 * worksheet actually contains. What caps the cost is the monthly extraction
 * quota in policy.mjs — a worksheet with more exercises just spends one
 * extraction, the same as a short one.
 *
 * The model's job stops at "which exercises are on this page". It is never
 * asked how long they will take, when they are due, or how far behind the
 * student is: the app computes all of that, because the model would be
 * confidently wrong and nothing would catch it.
 */
export function buildExtractPrompt(text) {
  return `Analyse the worksheet below and list every exercise in it — not the topics
behind them, the exercises themselves.

The text was read off a photograph or a PDF, so it may contain OCR mistakes,
stray marks read as characters, and lines out of order. Read past those. Lines
in [SQUARE BRACKETS] are labels added by the app, not part of the document — do
not treat them as content, and do not let them influence which language you
report.

MATERIAL:
${text}

TASK:
1. List every distinct exercise, problem or question in this material, in the
   exact order they appear. Do not skip any. Do not merge two exercises into
   one entry. Do not invent one the material does not contain.
2. If the material numbers or labels them (Exercise 3, תרגיל ב, Question 12,
   שאלה 4), start "label" with that exact label. If it does not label them,
   number them yourself in the order they appear ("1", "2", …).
3. For each exercise give:
   - label: its number or label from the page, plus a 2-4 word hint at what it
     asks. Short enough to read in a list.
   - text: the exercise itself, in full — the actual question or problem as
     written in the material, not a summary of its topic.
   - difficulty: how much work the exercise is, on this scale:
${difficultyCatalogue()}
     Judge the work, not the student. Rate what the exercise asks for, and
     nothing about who is doing it.
4. If a line is unreadable enough that you are guessing at what the exercise
   says, set "uncertain": true on it. The student is shown a correction screen
   before anything is saved, and flagged rows are the ones it puts in front of
   them first. Guessing silently is the one failure that matters here.

Reply with JSON and nothing else — no preamble, no code fence, no commentary:

{
  "language": "the ISO 639-1 code of the language the worksheet is written in",
  "items": [
    {
      "label": "תרגיל 3 — פתרון משוואה",
      "text": "The exercise itself, copied in full from the material",
      "difficulty": 2,
      "uncertain": false
    }
  ]
}

Write "label" and "text" in the worksheet's own language, not in English.`;
}

// ---------------------------------------------------------------- parsing

/**
 * Pull the first complete JSON object out of a model reply.
 *
 * Bracket-matching rather than a regex, and string-aware, because an exercise
 * body legitimately contains braces (`f(x) = {…}`) and quotes. A model told
 * "JSON and nothing else" still occasionally wraps it in a code fence or adds a
 * sentence of preamble; both survive this.
 */
export function extractJSON(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export const MAX_LABEL_CHARS = 120;
export const MAX_TEXT_CHARS = 2_000;
export const MAX_ITEMS = 200;

/**
 * Model output in, rows for the correction screen out.
 *
 * Fails closed and fails quietly: anything malformed is dropped rather than
 * shown broken, and a reply that yields nothing at all returns an empty list
 * rather than throwing. The caller's contract is that an empty list lands the
 * student on the manual-entry screen — never on an empty screen with no way
 * forward. Detection is never perfect; the correction step is not optional.
 *
 * `position` is assigned here, from the order the model returned, and is the
 * thing the whole prompt above is written to protect. It is never taken from
 * the model — a model that renumbers its own output would silently reorder a
 * student's homework.
 */
export function normaliseItems(reply) {
  const parsed = typeof reply === "string" ? extractJSON(reply) : reply;
  const raw = Array.isArray(parsed?.items) ? parsed.items : [];

  const items = [];
  for (const it of raw) {
    if (items.length >= MAX_ITEMS) break;
    const label = String(it?.label ?? "").trim().replace(/\s+/g, " ");
    const text = String(it?.text ?? "").trim();
    // A row with neither a label nor a body is not an exercise the student can
    // recognise on a checklist, so it is dropped rather than shown as a blank.
    if (!label && !text) continue;
    items.push({
      position: items.length + 1,
      label: (label || text).slice(0, MAX_LABEL_CHARS),
      text: text.slice(0, MAX_TEXT_CHARS),
      // null, never a default. An exercise the model did not rate is unrated,
      // and the ordering treats that differently from one it called easy — a
      // silent 3 would sort it into the middle of a list it was never judged
      // against.
      difficulty: cleanDifficulty(it?.difficulty),
      uncertain: it?.uncertain === true,
    });
  }

  return {
    language: typeof parsed?.language === "string" ? parsed.language.slice(0, 8) : "",
    items,
  };
}

/**
 * Renumber after the student has added, removed or reordered rows on the
 * correction screen. Positions are always 1..n with no gaps, so "exercise 4 of
 * 7" on the checklist means the fourth row on the page.
 */
export function renumber(items) {
  return items.map((it, i) => ({ ...it, position: i + 1 }));
}

// ---------------------------------------------------------------- rating

export const RATE_TEXT_CHARS = 240;

/**
 * The cheap call, and the one that runs on the ordinary path.
 *
 * `split.mjs` has already found the exercise boundaries by reading the page's
 * own numbering, for free. What a regular expression cannot do is say how much
 * work an exercise is, so that — and only that — is what this asks for. The
 * input is the list somebody already has and the output is one number each,
 * which is why it costs a fifth of what a full extraction can.
 *
 * Each exercise is truncated hard. Judging that a proof takes a while does not
 * require reading the whole proof, and paying to send it would give back the
 * saving this call exists to make.
 */
export const MAX_RATE_ITEMS = 120;

/**
 * As many exercises as fit the rating call's read budget, from the top.
 *
 * Trimming from the END rather than sampling across the list, so what does get
 * rated is a contiguous run starting at exercise one. A student who scanned a
 * page too long to rate in full sees the first thirty rated and the rest
 * unrated, which the ordering already knows how to handle — rather than a
 * scatter of rated and unrated rows with no pattern to it.
 */
export function fitRateItems(items, maxChars) {
  const kept = [];
  let used = 0;

  for (const item of items ?? []) {
    if (kept.length >= MAX_RATE_ITEMS) break;
    const label = String(item?.label || "").trim();
    const body = String(item?.text || "").trim().slice(0, RATE_TEXT_CHARS);
    const cost = label.length + body.length + 8; // numbering and newlines
    if (used + cost > maxChars && kept.length > 0) break;
    kept.push({ label, text: body });
    used += cost;
  }

  return { items: kept, dropped: (items?.length ?? 0) - kept.length };
}

export function buildRatePrompt(items) {
  const list = items
    .map((item, i) => {
      const body = String(item?.text || "").trim().slice(0, RATE_TEXT_CHARS);
      const label = String(item?.label || "").trim();
      return `${i + 1}. ${label}${body && body !== label ? `\n   ${body}` : ""}`;
    })
    .join("\n");

  return `Below is a list of exercises from one worksheet. Say how much work each
one is. Do not solve them, do not explain them, and do not rewrite them.

SCALE:
${difficultyCatalogue()}

Judge the work the exercise asks for, not the student doing it. An exercise is
not harder because a beginner would find it hard.

EXERCISES:
${list}

Reply with JSON and nothing else — no preamble, no code fence, no commentary.
Return one entry for every exercise above, using the same numbers:

{ "ratings": [ { "n": 1, "difficulty": 2 }, { "n": 2, "difficulty": 4 } ] }`;
}

/**
 * Ratings in, a level for each position out.
 *
 * Returns a Map from 1-based position to level, holding only the entries that
 * were both well-formed and about a position that exists. A model that returns
 * eight ratings for six exercises, or rates exercise 99, contributes the parts
 * that made sense and nothing else — the alternative is discarding a whole
 * usable reply over one bad row.
 */
export function normaliseRatings(reply, count) {
  const parsed = typeof reply === "string" ? extractJSON(reply) : reply;
  const rows = Array.isArray(parsed?.ratings) ? parsed.ratings : [];
  const out = new Map();

  for (const row of rows) {
    const n = Math.round(Number(row?.n));
    if (!Number.isFinite(n) || n < 1 || n > count) continue;
    const level = cleanDifficulty(row?.difficulty);
    if (level === null) continue;
    // First rating for a position wins, so a model that repeats itself cannot
    // change an answer it already gave.
    if (!out.has(n)) out.set(n, level);
  }

  return out;
}

/**
 * Apply a rating map to a list, leaving anything unrated exactly as it was.
 *
 * Never reorders and never drops: this is the step where a bad reply could
 * quietly rearrange a student's homework, so it only ever writes one field.
 */
export function applyRatings(items, ratings) {
  return items.map((item, i) => {
    const level = ratings.get(i + 1);
    return level === undefined ? item : { ...item, difficulty: level };
  });
}
