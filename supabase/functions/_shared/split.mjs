/**
 * Splitting a worksheet into exercises without asking a model.
 *
 * Almost every worksheet numbers its own exercises. That numbering is the
 * author telling us exactly where each exercise begins, in the document
 * itself, for free — and a model asked to find the same boundaries is being
 * paid to rediscover something the page already states.
 *
 * So this runs first, always. It costs nothing, takes no time, cannot invent
 * an exercise that is not there, and works with no network. The model is what
 * happens afterwards, when this finds nothing or the student says the list is
 * wrong.
 *
 * The one idea that makes it work is not the patterns below — those are easy
 * and each one on its own produces piles of false positives on OCR output.
 * It is step 3: a real numbering ASCENDS. Keeping only the longest ascending
 * run of markers throws away the page number, the year in a word problem, the
 * "5" in a price, and the stray character OCR read as "8." — because none of
 * them fits the sequence the actual exercises make.
 *
 * No I/O in this file. Same rule as the other shared modules.
 */

// Hebrew letter enumeration, in the order Israeli worksheets actually use.
// Final forms are absent on purpose: no worksheet labels an exercise "ך".
const HEBREW_ORDER = "אבגדהוזחטיכלמנסעפצקרשת";

// A separator after the marker: "3." "3)" "3 -" "3:" and the dash variants a
// Hebrew keyboard produces.
const SEP = String.raw`[.)\]:\-–—]`;

const PATTERNS = [
  {
    kind: "keyword",
    // "תרגיל 3", "שאלה ב", "Exercise 12". The strongest signal there is: a
    // word that means "exercise" is never a page number.
    re: new RegExp(
      String.raw`^(?:תרגיל|תרגילים|שאלה|שאלות|סעיף|בעיה|Exercise|Question|Problem|Task)\s*` +
      String.raw`(\d{1,3}|[${HEBREW_ORDER}])\s*${SEP}?\s*`,
      "iu",
    ),
  },
  {
    kind: "digit",
    // Requires whitespace after the separator, so "3.14" and "1.5 ליטר" are
    // not exercise three and exercise one.
    re: new RegExp(String.raw`^(\d{1,3})\s*${SEP}\s+`, "u"),
  },
  {
    kind: "hebrew",
    re: new RegExp(String.raw`^([${HEBREW_ORDER}])\s*${SEP}\s+`, "u"),
  },
  {
    kind: "latin",
    re: new RegExp(String.raw`^([a-z])\s*${SEP}\s+`, "iu"),
  },
];

// When two kinds both form a run, this decides which is the exercise level and
// which is the sub-part. A page numbered 1..8 with parts א,ב under each is far
// more common than the reverse.
const KIND_RANK = { keyword: 0, digit: 1, hebrew: 2, latin: 3 };

/** The ordinal a marker carries: 7 from "7", 3 from "ג", 2 from "b". */
function markerValue(kind, raw) {
  const token = String(raw).trim();
  if (/^\d+$/.test(token)) return Number(token);
  const hebrew = HEBREW_ORDER.indexOf(token);
  if (hebrew !== -1) return hebrew + 1;
  const latin = token.toLowerCase().charCodeAt(0) - 96;
  return latin >= 1 && latin <= 26 ? latin : null;
}

/**
 * A marker with nothing after it is a page number, not an exercise.
 *
 * "Nothing after it" means neither the rest of its own line nor the line below
 * carries any real content. That single check removes most of what a footer or
 * a header contributes.
 */
function hasContent(lines, index, rest) {
  if (rest.trim().length >= 3) return true;
  const next = lines[index + 1];
  return Boolean(next && next.trim().length >= 3);
}

function findMarkers(lines) {
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    for (const { kind, re } of PATTERNS) {
      const m = re.exec(line.trim());
      if (!m) continue;

      const value = markerValue(kind, m[1]);
      if (value === null) break;

      const rest = line.trim().slice(m[0].length);
      if (!hasContent(lines, i, rest)) break;

      found.push({ line: i, kind, value, marker: m[0].trim(), rest });
      break; // First pattern that matches wins; they are ordered by strength.
    }
  }
  return found;
}

/**
 * The longest strictly ascending run of values, keeping the original order.
 *
 * Gaps are allowed and expected: OCR turns a "6." into "б." often enough that
 * requiring 1,2,3,4,5,6 with nothing missing would reject real pages. What is
 * not allowed is going backwards, which is what a page number or a year does.
 */
function longestAscending(markers) {
  if (markers.length === 0) return [];

  const best = new Array(markers.length).fill(1);
  const prev = new Array(markers.length).fill(-1);
  let endsAt = 0;

  for (let i = 1; i < markers.length; i++) {
    for (let j = 0; j < i; j++) {
      if (markers[j].value < markers[i].value && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        prev[i] = j;
      }
    }
    if (best[i] > best[endsAt]) endsAt = i;
  }

  const run = [];
  for (let at = endsAt; at !== -1; at = prev[at]) run.unshift(markers[at]);
  return run;
}

export const MIN_EXERCISES = 2;
export const LABEL_CHARS = 60;

/**
 * Where the split came from and how much to trust it.
 *
 * "high" means the numbering starts at the beginning and almost every marker
 * of its kind fits the run — the page numbered itself and we read it. "medium"
 * means a plausible run that starts late or has outliers around it. Anything
 * weaker returns no items at all rather than a guess, because a wrong split is
 * worse than no split: the student would have to undo it before typing.
 */
function confidenceOf(run, all) {
  if (run.length < MIN_EXERCISES) return "none";
  const share = run.length / all.length;
  const startsAtStart = run[0].value <= 2;
  if (run.length >= 3 && share >= 0.8 && startsAtStart) return "high";
  if (run.length >= 3 && share >= 0.6) return "medium";
  return "low";
}

/**
 * Split a worksheet's text into exercises using its own numbering.
 *
 * Returns an empty list rather than throwing or guessing when the page is not
 * numbered. The caller treats that exactly like a failed model call, because
 * the next screen is the same one either way.
 */
export function splitExercises(text) {
  const lines = String(text || "").split(/\r?\n/);
  const markers = findMarkers(lines);

  // Each kind gets its own run, and the best run wins. A page numbered 1..8
  // with parts א,ב under each produces a digit run of 8 and a Hebrew run of 2,
  // so the digits become the exercises and the letters stay inside them.
  let winner = [];
  let winnerKind = null;
  let sameKind = [];

  for (const kind of Object.keys(KIND_RANK)) {
    const ofKind = markers.filter((m) => m.kind === kind);
    const run = longestAscending(ofKind);
    const better =
      run.length > winner.length ||
      (run.length === winner.length &&
        winnerKind !== null &&
        KIND_RANK[kind] < KIND_RANK[winnerKind]);
    if (better) {
      winner = run;
      winnerKind = kind;
      sameKind = ofKind;
    }
  }

  const confidence = confidenceOf(winner, sameKind);
  if (confidence === "none") {
    return { items: [], confidence, method: "numbering", markerKind: null };
  }

  const items = winner.map((marker, i) => {
    const until = i + 1 < winner.length ? winner[i + 1].line : lines.length;
    // The marker's own line contributes only what follows the marker; the
    // lines below it contribute whole. Sub-part markers inside this range are
    // left exactly as the page had them.
    const body = [marker.rest, ...lines.slice(marker.line + 1, until)]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const hint = body.split("\n")[0]?.trim() ?? "";
    return {
      position: i + 1,
      label: `${marker.marker} ${hint}`.trim().slice(0, LABEL_CHARS),
      text: body,
      // Reading a number off a page says nothing about how much work the
      // exercise is. That is the one judgement the model is still for, and
      // until it has been made the field is null rather than a guess.
      difficulty: null,
      // Nothing here is a guess in the model's sense — a marker was read off
      // the page or it was not — so no row is flagged. What the student is
      // told instead is the confidence of the split as a whole.
      uncertain: false,
    };
  });

  return { items, confidence, method: "numbering", markerKind: winnerKind };
}
