import { test } from "node:test";
import assert from "node:assert/strict";
import { nextUp, startWith, ORDERS } from "../supabase/functions/_shared/order.mjs";

const item = (position, difficulty, done = false) => ({
  position, difficulty, done_at: done ? "2026-09-06T10:00:00Z" : null,
});

test("easiest first, page order as the tie-break", () => {
  // Levels 1, 1, 2, 4 on pages 2, 3, 4, 1. The two level-ones keep the order
  // the teacher wrote them in.
  const list = [item(1, 4), item(2, 1), item(3, 1), item(4, 2)];
  assert.deepEqual(nextUp(list).map((i) => i.position), [2, 3, 4, 1]);
});

test("finished exercises never appear in the queue", () => {
  const list = [item(1, 1, true), item(2, 5), item(3, 2)];
  assert.deepEqual(nextUp(list).map((i) => i.position), [3, 2]);
});

test("unrated exercises sort after every rated one, in page order", () => {
  // Not into the middle. "Nobody judged this" is a different thing from
  // "average", and treating them the same would let an unrated row displace one
  // the model actually called quick.
  const list = [item(1, null), item(2, 5), item(3, null), item(4, 3)];
  assert.deepEqual(nextUp(list).map((i) => i.position), [4, 2, 1, 3]);
});

test("with nothing rated at all, the order is the page's own", () => {
  const list = [item(3, null), item(1, null), item(2, null)];
  assert.deepEqual(nextUp(list).map((i) => i.position), [1, 2, 3]);
  assert.equal(startWith(list).reason, "זה הבא בתור בדף.");
});

test("hardest first is the same sort, inverted, with the same tie-break", () => {
  const list = [item(1, 2), item(2, 5), item(3, 5), item(4, 1)];
  assert.deepEqual(nextUp(list, ORDERS.HARDEST).map((i) => i.position), [2, 3, 1, 4]);
});

test("page order ignores difficulty entirely", () => {
  const list = [item(2, 1), item(1, 5), item(3, 3)];
  assert.deepEqual(nextUp(list, ORDERS.PAGE).map((i) => i.position), [1, 2, 3]);
});

test("the sort never returns NaN when everything is unrated", () => {
  // Infinity minus Infinity is NaN, and a comparator that returns NaN produces
  // an order that differs between engines.
  const list = [item(3, null), item(1, null), item(2, null), item(5, null), item(4, null)];
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(nextUp(list.slice().reverse()).map((x) => x.position), [1, 2, 3, 4, 5]);
  }
});

test("startWith names the quickest of what is left", () => {
  const { item: pick, reason, remaining } = startWith([item(1, 4), item(2, 1), item(3, 3)]);
  assert.equal(pick.position, 2);
  assert.equal(reason, "זה הקצר מבין מה שנשאר.");
  assert.equal(remaining, 3);
});

test("startWith on the last one says so rather than calling it the shortest", () => {
  const { reason } = startWith([item(1, 3, true), item(2, 5)]);
  assert.equal(reason, "זה האחרון שנשאר.");
});

test("startWith on a finished assignment returns nothing, not a crash", () => {
  const done = startWith([item(1, 1, true), item(2, 2, true)]);
  assert.equal(done.item, null);
  assert.equal(done.reason, null);
  assert.equal(done.remaining, 0);
  assert.equal(startWith([]).item, null);
});

test("no reason ever praises or scolds", () => {
  const reasons = [
    startWith([item(1, 1), item(2, 5)]).reason,
    startWith([item(1, 1), item(2, 5)], ORDERS.HARDEST).reason,
    startWith([item(1, null), item(2, null)]).reason,
    startWith([item(1, 2)]).reason,
  ];
  for (const reason of reasons) {
    assert.ok(reason && reason.length > 0);
    for (const word of ["כל הכבוד", "מאחר", "פיגור", "נכשל", "בעיה"]) {
      assert.equal(reason.includes(word), false, `"${reason}" judges the student`);
    }
  }
});

test("the input list is never mutated", () => {
  const list = [item(3, 5), item(1, 1), item(2, 3)];
  const before = list.map((i) => i.position);
  nextUp(list);
  startWith(list);
  assert.deepEqual(list.map((i) => i.position), before);
});

test("doneAt is accepted as well as done_at", () => {
  // The database returns done_at; a draft in the browser carries doneAt. Both
  // reach this function, and a queue that silently included finished exercises
  // would be worse than an error.
  assert.deepEqual(
    nextUp([{ position: 1, difficulty: 1, doneAt: "2026-09-06T10:00:00Z" }, item(2, 3)])
      .map((i) => i.position),
    [2],
  );
});
