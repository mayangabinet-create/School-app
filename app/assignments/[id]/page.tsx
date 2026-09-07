"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, Check, Play } from "lucide-react";
import { Shell, SetupNotice, Spinner, Bar, DifficultyBadge, OrderPicker } from "@/components/Shell";
import { isConfigured } from "@/lib/supabase/client";
import {
  archiveAssignment, getAssignment, getExerciseOrder, setExerciseOrder, setItemDone,
  type Assignment, type Item,
} from "@/lib/data";
import { calendarDay, paceFor } from "@/lib/pace.mjs";
import { startWith, DEFAULT_ORDER, ORDER_LABELS, type Order } from "@/lib/order.mjs";

export default function AssignmentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>(DEFAULT_ORDER);
  const [orderNote, setOrderNote] = useState<string | null>(null);

  const today = calendarDay(new Date());

  const load = useCallback(async () => {
    try {
      const found = await getAssignment(params.id);
      if (!found) {
        setError("המטלה הזאת לא קיימת.");
        setItems([]);
        return;
      }
      setAssignment(found.assignment);
      setItems(found.items);

      // The preference is a second read rather than part of the first, so a
      // failure to load it cannot take the homework down with it. Falling back
      // to the default here is fine; failing to render the checklist is not.
      try {
        setOrder(await getExerciseOrder());
      } catch (err) {
        console.warn("could not read the saved order:", err);
      }
    } catch (err) {
      console.error(err);
      setError("לא הצלחנו לטעון את המטלה. רענן את הדף.");
      setItems([]);
    }
  }, [params.id]);

  useEffect(() => {
    if (isConfigured()) void load();
    else setItems([]);
  }, [load]);

  /**
   * Tick optimistically and put it back if the write fails.
   *
   * Ticking an exercise off is the single most frequent thing anyone does in
   * this app, and it must feel instant on a phone on a school network. What it
   * must not do is lie: a failed write puts the row back where it was and says
   * so, rather than leaving a tick that quietly does not exist.
   */
  const toggle = useCallback(async (item: Item) => {
    const done = !item.done_at;
    const optimistic = done ? new Date().toISOString() : null;

    setItems((current) =>
      (current ?? []).map((i) => (i.id === item.id ? { ...i, done_at: optimistic } : i)));
    setError(null);

    try {
      await setItemDone(item.id, done);
    } catch (err) {
      console.error(err);
      setItems((current) =>
        (current ?? []).map((i) => (i.id === item.id ? { ...i, done_at: item.done_at } : i)));
      setError("הסימון לא נשמר. בדוק את החיבור ונסה שוב.");
    }
  }, []);

  /**
   * Switch the order now; remember it in the background.
   *
   * The card re-answers immediately because the sort is local arithmetic and
   * waiting on a network round trip to reorder three items would be absurd. If
   * remembering fails, the choice still holds for this visit and the card says
   * so quietly — a preference that silently reverts on the next visit is the
   * kind of thing nobody reports, because the screen looked like it worked.
   */
  async function chooseOrder(next: Order) {
    setOrder(next);
    setOrderNote(null);
    try {
      await setExerciseOrder(next);
    } catch (err) {
      console.error(err);
      setOrderNote("הבחירה לא נשמרה, אז היא תחזור לברירת המחדל בכניסה הבאה.");
    }
  }

  if (!isConfigured()) return <Shell><SetupNotice /></Shell>;
  if (items === null) return <Shell><Spinner label="טוען…" /></Shell>;

  const total = items.length;
  const done = items.filter((i) => i.done_at).length;
  const pace = paceFor({ total, done, dueOn: assignment?.due_on ?? null, today });

  // Which one to start with. Computed here from the levels the model gave —
  // the model judged the exercises, the app decides what that means for the
  // list. Asking a model "what should I start with" would give an answer that
  // sounds reasonable, changes between calls, and cannot be checked.
  const next = startWith(items, order);

  return (
    <Shell>
      {error && <div className="notice notice-danger" role="alert">{error}</div>}

      {assignment && (
        <header className="stack rise" style={{ marginBottom: "var(--s-5)" }}>
          <h1 style={{ margin: 0 }}>{assignment.title}</h1>
          <Bar done={done} total={total} />
          <p className="soft" style={{ margin: 0 }}>{paceLine(pace)}</p>
        </header>
      )}

      {next.item && (
        <div className="card stack rise start-here">
          <span className="row faint">
            <Play size={14} aria-hidden />
            להתחיל כאן
          </span>
          <strong>{next.item.label}</strong>
          <span className="row" style={{ flexWrap: "wrap" }}>
            <DifficultyBadge level={next.item.difficulty} />
            <span className="faint">{next.reason}</span>
          </span>

          <OrderPicker value={order} onChange={chooseOrder} />
          <span className="faint">{ORDER_LABELS[order].hint}</span>
          {orderNote && <span className="faint">{orderNote}</span>}
        </div>
      )}

      <div className="stack" style={{ marginTop: "var(--s-4)" }}>
        {items.map((item) => (
          <button
            key={item.id}
            className={`item${item.done_at ? " is-done" : ""}`}
            onClick={() => void toggle(item)}
            aria-pressed={Boolean(item.done_at)}
          >
            <span className="tick" aria-hidden>
              {item.done_at && <Check size={14} strokeWidth={3} />}
            </span>
            <span className="grow stack" style={{ gap: "var(--s-1)" }}>
              <span className="between">
                <span className="item-label grow">{item.label}</span>
                <DifficultyBadge level={item.difficulty} />
              </span>
              {item.body && <span className="item-body">{item.body}</span>}
            </span>
          </button>
        ))}
      </div>

      {total === 0 && !error && (
        <div className="card empty">אין תרגילים במטלה הזאת.</div>
      )}

      {assignment && (
        <div style={{ marginTop: "var(--s-6)" }}>
          <button
            className="btn btn-quiet btn-block"
            onClick={async () => {
              try {
                await archiveAssignment(assignment.id);
                router.push("/");
              } catch (err) {
                console.error(err);
                setError("לא הצלחנו לארכב את המטלה.");
              }
            }}
          >
            <Archive size={16} aria-hidden />
            העבר לארכיון
          </button>
        </div>
      )}
    </Shell>
  );
}

/**
 * One sentence about where this stands.
 *
 * Every number in it is computed, never generated and never stored. There is no
 * praise for being ahead and no reproach for being behind — being behind simply
 * makes today's number larger, which is the only part that helps.
 */
function paceLine(pace: ReturnType<typeof paceFor>): string {
  if (pace.total === 0) return "אין תרגילים ברשימה.";
  if (pace.status === "done") return "הכול מסומן. סיימת את המטלה.";

  const left = `נשארו ${pace.remaining} מתוך ${pace.total}`;

  if (pace.status === "overdue") {
    const late = Math.abs(pace.daysLeft ?? 0);
    return `${left}. התאריך עבר לפני ${late === 1 ? "יום" : `${late} ימים`}.`;
  }
  if (pace.status === "due-today") return `${left}, והמטלה להיום.`;
  if (pace.status === "undated") return `${left}. אין תאריך הגשה.`;

  const days = pace.daysLeft ?? 0;
  return `${left}. נשארו ${days === 1 ? "יום אחד" : `${days} ימים`}, כלומר ${pace.perDay} ליום.`;
}
