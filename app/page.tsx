"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Camera, PencilLine } from "lucide-react";
import { Shell, SetupNotice, Spinner, Bar } from "@/components/Shell";
import { isConfigured } from "@/lib/supabase/client";
import { listOpenAssignments, type AssignmentSummary } from "@/lib/data";
import { calendarDay, todayPlan, paceFor } from "@/lib/pace.mjs";

type Row = AssignmentSummary & { pace: ReturnType<typeof paceFor> };

export default function TodayPage() {
  const [rows, setRows] = useState<AssignmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The student's calendar day, in their own zone. Read once per render pass
  // rather than inside the pace functions, so every number on this screen is
  // computed against the same day even if the clock rolls over mid-render.
  const today = calendarDay(new Date());

  const load = useCallback(async () => {
    try {
      setRows(await listOpenAssignments());
    } catch (err) {
      console.error(err);
      setError("לא הצלחנו לטעון את הרשימה. רענן את הדף.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    if (isConfigured()) void load();
    else setRows([]);
  }, [load]);

  if (!isConfigured()) {
    return (
      <Shell>
        <SetupNotice />
      </Shell>
    );
  }

  if (rows === null) {
    return (
      <Shell>
        <Spinner label="טוען…" />
      </Shell>
    );
  }

  const plan = todayPlan(rows, today);

  return (
    <Shell>
      {error && <div className="notice notice-danger">{error}</div>}

      <header className="rise" style={{ marginBottom: "var(--s-5)" }}>
        <h1>
          {plan.dueToday > 0 ? (
            <>
              היום: <span className="figure">{plan.dueToday}</span> תרגילים
            </>
          ) : (
            "אין מה לעשות היום"
          )}
        </h1>
        <p className="soft">{summaryLine(plan, rows.length)}</p>
      </header>

      {rows.length === 0 && <EmptyState />}

      <Group title="באיחור" tone="late" rows={plan.buckets.overdue as Row[]} today={today} />
      <Group title="להיום" tone="soon" rows={plan.buckets.dueToday as Row[]} today={today} />
      <Group title="בהמשך" tone="quiet" rows={plan.buckets.scheduled as Row[]} today={today} />
      <Group title="בלי תאריך" tone="quiet" rows={plan.buckets.undated as Row[]} today={today} />
    </Shell>
  );
}

function summaryLine(plan: ReturnType<typeof todayPlan>, count: number): string {
  if (count === 0) return "עוד לא הוספת שום דבר.";
  if (plan.remaining === 0) return "סיימת הכול. אין תרגילים פתוחים.";
  if (plan.overdue > 0) {
    // Named plainly, and that is all. Nothing here scolds, and nothing counts
    // down a score: falling behind raises today's number and says nothing else.
    return `${plan.overdue} מהם היו אמורים להיות מוכנים כבר. סך הכול נשארו ${plan.remaining}.`;
  }
  return `סך הכול נשארו ${plan.remaining} תרגילים פתוחים.`;
}

function EmptyState() {
  return (
    <div className="card empty stack rise">
      <p>צלם דף עבודה והתרגילים יהפכו לרשימה שאפשר לסמן.</p>
      <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        <Link href="/scan" className="btn btn-primary">
          <Camera size={18} aria-hidden />
          סרוק דף
        </Link>
        <Link href="/scan?manual=1" className="btn">
          <PencilLine size={18} aria-hidden />
          הקלד ידנית
        </Link>
      </div>
    </div>
  );
}

function Group({
  title, tone, rows, today,
}: {
  title: string;
  tone: "late" | "soon" | "quiet";
  rows: Row[];
  today: string;
}) {
  if (rows.length === 0) return null;

  return (
    <section>
      <h2>{title}</h2>
      <div className="stack">
        {rows.map((row) => (
          <Link key={row.id} href={`/assignments/${row.id}`} className="card stack rise"
                style={{ textDecoration: "none", color: "inherit" }}>
            <div className="between">
              <span className="grow" style={{ fontWeight: 600 }}>{row.title}</span>
              <DueBadge row={row} tone={tone} today={today} />
            </div>
            <Bar done={row.done} total={row.total} />
            <span className="faint">
              {row.done} מתוך {row.total} · היום כדאי לעשות {row.pace.perDay}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function DueBadge({ row, tone, today }: { row: Row; tone: string; today: string }) {
  const { status, daysLeft } = row.pace;

  if (status === "overdue") {
    const late = Math.abs(daysLeft ?? 0);
    return <span className="badge badge-late">{late === 1 ? "יום באיחור" : `${late} ימים באיחור`}</span>;
  }
  if (status === "due-today") return <span className="badge badge-soon">להיום</span>;
  if (status === "undated") return <span className="badge badge-quiet">בלי תאריך</span>;

  const days = daysLeft ?? 0;
  return (
    <span className={`badge badge-${tone === "late" ? "late" : "quiet"}`}>
      {days === 1 ? "עוד יום" : `עוד ${days} ימים`}
      <span className="sr-only"> עד {row.due_on ?? today}</span>
    </span>
  );
}
