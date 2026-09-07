/**
 * Which exercise to start with.
 *
 * The model says how much work each exercise is. This decides what that means
 * for the list, and it is arithmetic and a sort — the app's job, not the
 * model's. Asking a model "what should I start with" would produce an answer
 * that sounds reasonable, changes between calls, and cannot be checked.
 *
 * Which order is right is not a fact, so the app does not pretend to know it.
 * Easiest first suits a student who is stuck on starting; page order suits a
 * worksheet whose exercises build on each other, where skipping ahead costs
 * more than it saves; hardest first suits somebody already sitting down with a
 * clear head. Each is defensible and none is correct, so the student picks, the
 * choice is remembered, and the screen answers the one question they asked:
 * which exercise is first.
 *
 * The reason comes back with the answer, so the screen can say why this one
 * rather than leaving a recommendation to be taken on trust.
 *
 * No I/O in this file.
 */

export const ORDERS = {
  EASIEST: "easiest",
  PAGE: "page",
  HARDEST: "hardest",
};

/** Every legal value, for a picker to render and a constraint to check against. */
export const ORDER_VALUES = Object.values(ORDERS);

export const DEFAULT_ORDER = ORDERS.EASIEST;

/**
 * What each order is called, and what it is for.
 *
 * Defined once, here, so the picker, the database constraint and this module
 * cannot drift apart — a stored value the UI has no label for renders as a
 * blank button, and a UI value the constraint rejects fails to save with no
 * explanation. A test checks the constraint against ORDER_VALUES for exactly
 * that reason.
 *
 * The hints describe when an order helps, not who it is for. "For students who
 * struggle" would be a judgement, and nothing on this screen judges anybody.
 */
export const ORDER_LABELS = {
  [ORDERS.EASIEST]: {
    label: "הקצר קודם",
    hint: "ניצחון מהיר בהתחלה, כשקשה להתחיל",
  },
  [ORDERS.PAGE]: {
    label: "לפי סדר הדף",
    hint: "כשהתרגילים בנויים זה על זה",
  },
  [ORDERS.HARDEST]: {
    label: "הכבד קודם",
    hint: "להוריד את הגדול מהדרך כשהראש רענן",
  },
};

/**
 * A stored or submitted order, or the default.
 *
 * Never throws and never passes an unknown value through to the sort. A row
 * written by an older version of the app, or a value typed into a request by
 * hand, falls back rather than producing an order nobody chose.
 */
export function cleanOrder(value) {
  return ORDER_VALUES.includes(value) ? value : DEFAULT_ORDER;
}

const isDone = (item) => Boolean(item?.done_at ?? item?.doneAt);

/**
 * Unrated exercises sort after every rated one, in page order.
 *
 * Not to the middle, and not to the front. "We have not judged this" is a
 * different thing from "this is average", and collapsing the two would let an
 * unrated exercise displace one the model actually called quick. When nothing
 * is rated at all — the rating call failed, or has not run — every item lands
 * in this bucket and the whole list degrades to page order, which is the right
 * answer with no information.
 */
function rank(item, order) {
  const level = item?.difficulty;
  if (level === null || level === undefined) return Number.POSITIVE_INFINITY;
  return order === ORDERS.HARDEST ? -level : level;
}

/**
 * The undone exercises, in the order to do them.
 *
 * Page order is always the tie-break, so two exercises the model rated the same
 * stay in the order the teacher wrote them. The sort is stable in that respect
 * by construction rather than by trusting the engine.
 */
export function nextUp(items, requested = DEFAULT_ORDER) {
  const order = cleanOrder(requested);
  const open = (items ?? []).filter((item) => !isDone(item));
  if (order === ORDERS.PAGE) {
    return open.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  return open.slice().sort((a, b) => {
    const byRank = rank(a, order) - rank(b, order);
    if (byRank !== 0 && Number.isFinite(byRank)) return byRank;
    // Infinity minus Infinity is NaN, which a comparator must never return.
    if (Number.isNaN(byRank)) return (a.position ?? 0) - (b.position ?? 0);
    if (byRank !== 0) return byRank;
    return (a.position ?? 0) - (b.position ?? 0);
  });
}

/**
 * The one to start with, and why — in words the screen can print.
 *
 * The reason is never praise and never a nudge about how far behind anyone is.
 * It says what the app knows and stops: this one is the quickest of what is
 * left, or this one is simply next.
 */
export function startWith(items, requested = DEFAULT_ORDER) {
  const order = cleanOrder(requested);
  const queue = nextUp(items, order);
  if (queue.length === 0) return { item: null, reason: null, remaining: 0 };

  const item = queue[0];
  const rated = queue.filter((i) => i.difficulty !== null && i.difficulty !== undefined);

  let reason;
  if (rated.length === 0) {
    reason = "זה הבא בתור בדף.";
  } else if (order === ORDERS.PAGE) {
    reason = "זה הבא בתור בדף.";
  } else if (item.difficulty === null || item.difficulty === undefined) {
    reason = "זה הבא בתור בדף.";
  } else if (order === ORDERS.HARDEST) {
    reason = "זה הכבד מבין מה שנשאר.";
  } else {
    reason = queue.length === 1
      ? "זה האחרון שנשאר."
      : "זה הקצר מבין מה שנשאר.";
  }

  return { item, reason, remaining: queue.length };
}
