import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextUp, startWith, ORDERS, ORDER_VALUES, ORDER_LABELS, DEFAULT_ORDER, cleanOrder,
} from "../supabase/functions/_shared/order.mjs";

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

// ---------------------------------------------------------------- the choice

test("every order has a label and a hint, and nothing else does", () => {
  assert.deepEqual(ORDER_VALUES.slice().sort(), Object.keys(ORDER_LABELS).sort());
  for (const order of ORDER_VALUES) {
    assert.ok(ORDER_LABELS[order].label, `${order} has no label`);
    assert.ok(ORDER_LABELS[order].hint, `${order} has no hint`);
  }
});

test("the hints describe when an order helps, never who it is for", () => {
  const words = Object.values(ORDER_LABELS).flatMap((b) => [b.label, b.hint]).join(" ");
  for (const judgement of ["חלש", "מתקשה", "עצלן", "טוב יותר", "מומלץ"]) {
    assert.equal(words.includes(judgement), false, `a hint says "${judgement}"`);
  }
});

test("the default is one of the real values", () => {
  assert.ok(ORDER_VALUES.includes(DEFAULT_ORDER));
});

test("cleanOrder passes real values and replaces everything else", () => {
  for (const order of ORDER_VALUES) assert.equal(cleanOrder(order), order);
  for (const bad of [null, undefined, "", "EASIEST", "random", 3, {}, []]) {
    assert.equal(cleanOrder(bad), DEFAULT_ORDER, `${JSON.stringify(bad)} should fall back`);
  }
});

test("an unknown order sorts as the default rather than not sorting at all", () => {
  // A row written by a newer version of the app, or a value typed into a
  // request by hand, must not reach the comparator.
  const list = [item(1, 5), item(2, 1), item(3, 3)];
  assert.deepEqual(
    nextUp(list, "something-else").map((i) => i.position),
    nextUp(list, DEFAULT_ORDER).map((i) => i.position),
  );
  assert.equal(startWith(list, "something-else").item.position, 2);
});

test("each order answers with a different first exercise on the same list", () => {
  // The whole point of letting the student choose: the answer has to actually
  // depend on the choice.
  const list = [item(1, 5), item(2, 1), item(3, 3)];
  assert.equal(startWith(list, ORDERS.EASIEST).item.position, 2);
  assert.equal(startWith(list, ORDERS.PAGE).item.position, 1);
  assert.equal(startWith(list, ORDERS.HARDEST).item.position, 1);

  // And on a list where page order and hardest genuinely differ.
  const other = [item(1, 2), item(2, 5), item(3, 4)];
  assert.equal(startWith(other, ORDERS.EASIEST).item.position, 1);
  assert.equal(startWith(other, ORDERS.PAGE).item.position, 1);
  assert.equal(startWith(other, ORDERS.HARDEST).item.position, 2);
});

test("every order returns a reason, in every state", () => {
  const cases = [
    [item(1, 3), item(2, 1)],
    [item(1, null), item(2, null)],
    [item(1, 4)],
    [item(1, 2), item(2, null)],
  ];
  for (const order of ORDER_VALUES) {
    for (const list of cases) {
      const { item: pick, reason } = startWith(list, order);
      assert.ok(pick, `${order} found nothing in a list with open items`);
      assert.ok(reason && reason.trim().length > 0, `${order} gave no reason`);
    }
  }
});
