"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Archive, Check } from "lucide-react";
import { Shell, SetupNotice, Spinner, Bar } from "@/components/Shell";
import { isConfigured } from "@/lib/supabase/client";
import { archiveAssignment, getAssignment, setItemDone, type Assignment, type Item } from "@/lib/data";
import { calendarDay, paceFor } from "@/lib/pace.mjs";

export default function AssignmentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (!isConfigured()) return <Shell><SetupNotice /></Shell>;
  if (items === null) return <Shell><Spinner label="טוען…" /></Shell>;

  const total = items.length;
  const done = items.filter((i) => i.done_at).length;
  const pace = paceFor({ total, done, dueOn: assignment?.due_on ?? null, today });

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

      <div className="stack">
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
              <span className="item-label">{item.label}</span>
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
