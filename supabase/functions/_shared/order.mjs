/**
 * Which exercise to start with.
 *
 * The model says how much work each exercise is. This decides what that means
 * for the list, and it is arithmetic and a sort — the app's job, not the
 * model's. Asking a model "what should I start with" would produce an answer
 * that sounds reasonable, changes between calls, and cannot be checked.
 *
 * Easiest first, because the problem with homework is not finishing it, it is
 * starting it. One quick win lowers the doorway. It is not the only defensible
 * order — a page whose exercises build on each other wants page order, and
 * somebody already sitting down might want the hard one while fresh — so the
 * order is a named strategy rather than a hard-coded sort, and the reason is
 * returned alongside the answer so the screen can say why.
 *
 * No I/O in this file.
 */

export const ORDERS = {
  EASIEST: "easiest",
  PAGE: "page",
  HARDEST: "hardest",
};

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
export function nextUp(items, order = ORDERS.EASIEST) {
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
export function startWith(items, order = ORDERS.EASIEST) {
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
