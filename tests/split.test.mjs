import { test } from "node:test";
import assert from "node:assert/strict";
import { splitExercises, MIN_EXERCISES } from "../supabase/functions/_shared/split.mjs";
import { normaliseItems } from "../supabase/functions/_shared/worksheet.mjs";
import { WORKSHEETS } from "./fixtures/worksheets.mjs";

test("every fixture splits into exactly the number recorded for it", () => {
  const wrong = [];
  for (const w of WORKSHEETS) {
    const got = splitExercises(w.text).items.length;
    if (got !== w.split) wrong.push(`${w.name}: expected ${w.split}, got ${got}`);
  }
  assert.deepEqual(wrong, []);
});

test("sub-parts stay inside their exercise instead of becoming rows", () => {
  const { items } = splitExercises(WORKSHEETS.find((w) => w.name.includes("sub-parts")).text);
  assert.equal(items.length, 3);
  assert.match(items[1].text, /א\./, "the sub-parts are still in the body");
  assert.match(items[1].text, /ג\./);
});

test("an unnumbered page returns nothing rather than a guess", () => {
  // This is the case the model exists for. A wrong split is worse than no
  // split: the student would have to undo it before they could type.
  const { items, confidence } = splitExercises(
    WORKSHEETS.find((w) => w.name.includes("unnumbered")).text,
  );
  assert.deepEqual(items, []);
  assert.equal(confidence, "none");
});

test("one marker is not a numbering", () => {
  assert.equal(splitExercises("1. פתור את המשוואה x + 1 = 2").items.length, 0);
  assert.ok(MIN_EXERCISES >= 2);
});

test("a page number below the exercises does not become one", () => {
  const { items } = splitExercises(
    WORKSHEETS.find((w) => w.name.includes("page number")).text,
  );
  assert.equal(items.length, 3);
  assert.equal(items.some((i) => i.text.trim() === "2"), false);
});

test("an answer key does not double the list", () => {
  const { items } = splitExercises(
    WORKSHEETS.find((w) => w.name.includes("answer key")).text,
  );
  assert.equal(items.length, 4);
  assert.match(items[0].text, /5 \+ 3/, "the exercises win, not the answers");
});

test("a decimal is not an exercise marker", () => {
  assert.equal(splitExercises("3.14 הוא קירוב לפאי\n2.5 ליטר\n1.5 קילוגרם").items.length, 0);
});

test("markers that go backwards are dropped", () => {
  // Real numbering ascends. A 9 followed by a 3 is two different things on
  // the page, and only one of them is a list of exercises.
  const { items } = splitExercises(
    ["9. משהו אחר לגמרי כאן", "1. פתור: x = 1", "2. פתור: x = 2", "3. פתור: x = 3"].join("\n"),
  );
  assert.equal(items.length, 3);
  assert.match(items[0].text, /x = 1/);
});

test("digits win over letters when both form a run", () => {
  const { markerKind, items } = splitExercises(WORKSHEETS[1].text);
  assert.equal(markerKind, "digit");
  assert.equal(items.length, 3);
});

test("positions are 1..n in page order, with no gaps", () => {
  for (const w of WORKSHEETS) {
    const { items } = splitExercises(w.text);
    assert.deepEqual(items.map((i) => i.position), items.map((_, i) => i + 1), w.name);
  }
});

test("the shape matches what the model path returns", () => {
  // Both paths feed the same correction screen, so a row from one must be
  // indistinguishable in shape from a row from the other. Compared against a
  // real normaliseItems result rather than a list typed out here, so adding a
  // field to one path and forgetting the other fails immediately.
  const { items } = splitExercises(WORKSHEETS[0].text);
  const fromModel = normaliseItems({
    items: [{ label: "תרגיל 1", text: "פתור", difficulty: 3, uncertain: false }],
  }).items[0];

  assert.ok(items.length > 0);
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), Object.keys(fromModel).sort());
    assert.equal(typeof item.label, "string");
    assert.equal(typeof item.text, "string");
    assert.equal(typeof item.uncertain, "boolean");
    assert.equal(item.difficulty, null, "the splitter never guesses a difficulty");
    assert.ok(item.label.length > 0);
  }
});

test("bad input is an empty list, never a throw", () => {
  for (const bad of ["", null, undefined, 7, "   \n\n  "]) {
    assert.deepEqual(splitExercises(bad).items, [], `input ${JSON.stringify(bad)}`);
  }
});

test("how much of the work the offline splitter does alone", () => {
  // Reported rather than asserted at a threshold. The number is a regression
  // guard, not a measurement: these pages were written to exercise the
  // splitter, so they say nothing about how it does on whatever a real student
  // photographs. Only real pages can say that.
  const withWork = WORKSHEETS.filter((w) => w.exercises > 0);

  const exact = withWork.filter((w) => splitExercises(w.text).items.length === w.exercises);
  const fellThrough = withWork.filter((w) => splitExercises(w.text).items.length === 0);
  const partial = withWork.filter((w) => {
    const got = splitExercises(w.text).items.length;
    return got > 0 && got !== w.exercises;
  });

  console.log(
    `    offline splitter, on ${withWork.length} pages that have exercises: ` +
    `${exact.length} exact, ${partial.length} partial, ${fellThrough.length} need the model.`,
  );
  for (const w of [...partial, ...fellThrough]) {
    console.log(`      not alone: ${w.name} (${w.exercises} on the page, ` +
      `${splitExercises(w.text).items.length} split)`);
  }

  // The guard is that these two lists do not grow. A page moving out of
  // "exact" is a regression even if the total still looks healthy.
  assert.equal(partial.length, 1);
  assert.equal(fellThrough.length, 2);
});
