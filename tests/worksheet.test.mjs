import { test } from "node:test";
import assert from "node:assert/strict";
import {
  materialStats, assessWorksheetMaterial, buildExtractPrompt,
  extractJSON, normaliseItems, renumber,
  WORKSHEET_MIN_CHARS, MAX_ITEMS, MAX_TEXT_CHARS,
} from "../supabase/functions/_shared/worksheet.mjs";

const REAL_WORKSHEET = `
דף עבודה — משוואות ממעלה ראשונה
1. פתור: 2x + 5 = 13
2. פתור: 3(x - 4) = 9
3. אם 5x = 45, מהו x?
4. נתון מלבן שאורכו x+3 ורוחבו 4. שטחו 32. מצא את x.
5. פתור את המערכת: x + y = 10 , x - y = 2
`;

test("materialStats is arithmetic and nothing more", () => {
  const st = materialStats("abc 123 def");
  assert.equal(st.chars, 11);
  assert.equal(st.words, 3);
  assert.equal(st.realWords, 2, "'123' has no three-letter run");
  assert.ok(st.digitShare > 0.2);
  assert.equal(materialStats("").chars, 0);
  assert.equal(materialStats(null).vocabulary, 0, "no division by zero on empty input");
});

test("the gate accepts a page that is mostly digits and symbols", () => {
  // This is the whole reason worksheet mode needs its own gate: the old app's
  // prose gate rejects exactly this shape.
  assert.equal(assessWorksheetMaterial(REAL_WORKSHEET), null);
});

test("the gate accepts an all-numeric exercise page with almost no words", () => {
  const numeric = Array.from({ length: 30 }, (_, i) => `${i + 1}. ${i * 7} + ${i * 3} = ?`).join("\n");
  const st = materialStats(numeric);
  assert.ok(st.digitShare > 0.2, "precondition: this really is mostly digits");
  assert.ok(st.realWords < st.words * 0.4, "precondition: barely any real words");
  assert.equal(assessWorksheetMaterial(numeric), null);
});

test("the gate refuses a photograph that came back as noise", () => {
  const r = assessWorksheetMaterial("l1 . ,, ~");
  assert.equal(r?.code, "too-short");
  assert.match(r.detail, /\d+/, "says how much was actually read");
  assert.ok(r.fix, "every refusal names something the student can do");
});

test("the too-short boundary is the constant, not a magic number", () => {
  assert.equal(assessWorksheetMaterial("x".repeat(WORKSHEET_MIN_CHARS - 1))?.code, "too-short");
  assert.equal(assessWorksheetMaterial("x".repeat(WORKSHEET_MIN_CHARS)), null);
});

test("the gate refuses a scan that got stuck on one line", () => {
  const stuck = "פתור את התרגיל הבא בעזרת הנוסחה שלמדנו בכיתה היום ".repeat(60);
  const r = assessWorksheetMaterial(stuck);
  assert.equal(r?.code, "repetitive");
});

test("the prompt forbids merging, skipping and inventing, and keeps the numbering", () => {
  const p = buildExtractPrompt("1. Solve 2x=4");
  assert.match(p, /Do not skip any/);
  assert.match(p, /Do not merge two exercises into/);
  assert.match(p, /Do not invent one the material does not contain/);
  assert.match(p, /exact order they appear/);
  assert.match(p, /start "label" with that exact label/);
  assert.ok(p.includes("1. Solve 2x=4"), "the material is actually in the prompt");
});

test("the prompt never asks the model to do arithmetic or scheduling", () => {
  const p = buildExtractPrompt("1. Solve 2x=4").toLowerCase();
  for (const forbidden of ["how long", "how many days", "due", "deadline", "schedule", "estimate the time"]) {
    assert.equal(p.includes(forbidden), false, `prompt must not ask the model about "${forbidden}"`);
  }
});

test("extractJSON survives a preamble, a code fence and braces inside a string", () => {
  assert.deepEqual(extractJSON('Sure! {"a":1}'), { a: 1 });
  assert.deepEqual(extractJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(
    extractJSON('{"text":"f(x) = {2x} and \\"y\\""}'),
    { text: 'f(x) = {2x} and "y"' },
    "a brace or a quote inside an exercise body must not end the object",
  );
  assert.equal(extractJSON("no json here"), null);
  assert.equal(extractJSON('{"a":'), null, "a truncated reply is null, not a throw");
  assert.equal(extractJSON(""), null);
  assert.equal(extractJSON(null), null);
});

test("positions come from the order returned, never from the model", () => {
  const { items } = normaliseItems({
    items: [
      { label: "תרגיל 7", text: "a", position: 99 },
      { label: "תרגיל 8", text: "b", position: 1 },
    ],
  });
  assert.deepEqual(items.map(i => i.position), [1, 2]);
  assert.deepEqual(items.map(i => i.label), ["תרגיל 7", "תרגיל 8"]);
});

test("a row with no label falls back to its body rather than showing blank", () => {
  const { items } = normaliseItems({ items: [{ text: "Solve for x" }] });
  assert.equal(items[0].label, "Solve for x");
});

test("rows with neither a label nor a body are dropped, not shown broken", () => {
  const { items } = normaliseItems({
    items: [{ label: "ok", text: "t" }, { label: "  ", text: "" }, null, 42],
  });
  assert.equal(items.length, 1);
});

test("garbage in yields an empty list, never a throw", () => {
  // The caller's contract: an empty list lands the student on manual entry.
  for (const bad of ["", "I could not read this page.", "{}", '{"items":"nope"}', null, undefined, 7]) {
    const out = normaliseItems(bad);
    assert.deepEqual(out.items, [], `input ${JSON.stringify(bad)}`);
    assert.equal(typeof out.language, "string");
  }
});

test("the uncertain flag survives only as a real boolean", () => {
  const { items } = normaliseItems({
    items: [
      { label: "a", uncertain: true },
      { label: "b", uncertain: "yes" },
      { label: "c" },
    ],
  });
  assert.deepEqual(items.map(i => i.uncertain), [true, false, false]);
});

test("oversized replies are bounded", () => {
  const many = Array.from({ length: MAX_ITEMS + 50 }, (_, i) => ({ label: `x${i}` }));
  assert.equal(normaliseItems({ items: many }).items.length, MAX_ITEMS);
  const long = normaliseItems({ items: [{ label: "a", text: "y".repeat(MAX_TEXT_CHARS + 500) }] });
  assert.equal(long.items[0].text.length, MAX_TEXT_CHARS);
});

test("a string reply is parsed the same as a parsed one", () => {
  const raw = '{"language":"he","items":[{"label":"תרגיל 1","text":"פתור"}]}';
  assert.deepEqual(normaliseItems(raw), normaliseItems(JSON.parse(raw)));
});

test("language is carried through but bounded", () => {
  assert.equal(normaliseItems({ language: "he", items: [] }).language, "he");
  assert.equal(normaliseItems({ language: "x".repeat(50), items: [] }).language.length, 8);
  assert.equal(normaliseItems({ language: 7, items: [] }).language, "");
});

test("renumber closes gaps after the student edits the list", () => {
  const edited = [
    { position: 1, label: "a" },
    { position: 5, label: "b" },
    { position: 9, label: "c" },
  ];
  assert.deepEqual(renumber(edited).map(i => i.position), [1, 2, 3]);
  assert.deepEqual(renumber(edited).map(i => i.label), ["a", "b", "c"], "order is preserved");
  assert.deepEqual(renumber([]), []);
});
