"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell, SetupNotice, Spinner } from "@/components/Shell";
import { isConfigured } from "@/lib/supabase/client";
import { listAllItems } from "@/lib/data";
import { calendarDay } from "@/lib/pace.mjs";
import { summariseProgress, type ProgressSummary } from "@/lib/progress.mjs";
import { DIFFICULTY } from "@/lib/worksheet.mjs";

const WEEKDAYS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

export default function ProgressPage() {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = calendarDay(new Date());

  const load = useCallback(async () => {
    try {
      setSummary(summariseProgress(await listAllItems(), { today }));
    } catch (err) {
      console.error(err);
      setError("לא הצלחנו לטעון את ההתקדמות. רענן את הדף.");
    }
  }, [today]);

  useEffect(() => {
    if (isConfigured()) void load();
  }, [load]);

  if (!isConfigured()) return <Shell><SetupNotice /></Shell>;
  if (error) return <Shell><div className="notice notice-danger" role="alert">{error}</div></Shell>;
  if (!summary) return <Shell><Spinner label="טוען…" /></Shell>;

  return (
    <Shell>
      <h1>כמה עשית</h1>

      {summary.total === 0 ? (
        <div className="card empty">
          עוד לא סימנת שום תרגיל. ברגע שתסמני, הכול יופיע כאן.
        </div>
      ) : (
        <>
          {/* A total is a number, not a chart. Drawing it would add ink and
              remove clarity. */}
          <div className="tiles rise">
            <Tile value={summary.total} label="תרגילים בסך הכול" />
            <Tile value={summary.today} label="היום" />
            <Tile value={summary.thisWeek} label="בשבוע האחרון" />
            <Tile value={summary.streak} label={summary.streak === 1 ? "יום ברצף" : "ימים ברצף"} />
          </div>

          <WeekChart recent={summary.recent} />
          <DifficultyChart byDifficulty={summary.byDifficulty} total={summary.total} />
        </>
      )}
    </Shell>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="tile">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

/**
 * Seven days, one bar each.
 *
 * One series, so one colour and no legend — the heading names it. The bars are
 * NOT coloured by their own value: bar length already encodes how many, and
 * spending the colour channel to say the same thing again just makes the chart
 * louder.
 *
 * Every bar is drawn against the same maximum and starts at zero. A day with
 * nothing on it keeps its column in a recessive grey rather than vanishing,
 * because a missing column would quietly turn a seven-day week into a five-day
 * one and make the good days look denser than they were.
 */
function WeekChart({ recent }: { recent: { day: string; count: number }[] }) {
  const max = Math.max(1, ...recent.map((d) => d.count));

  return (
    <section>
      <h2>השבוע האחרון</h2>
      <div className="card">
        <div className="chart-days">
          {recent.map((d) => (
            <div
              key={d.day}
              className={`chart-day${d.count === 0 ? " is-empty" : ""}`}
              title={`${d.day}: ${d.count} תרגילים`}
            >
              <i style={{ height: `${(Math.max(d.count, 0) / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="chart-axis" aria-hidden>
          {recent.map((d) => (
            <span key={d.day}>{WEEKDAYS[new Date(`${d.day}T00:00:00Z`).getUTCDay()]}</span>
          ))}
        </div>

        <DataTable
          caption="תרגילים לפי יום"
          head={["יום", "תרגילים"]}
          rows={recent.map((d) => [d.day, String(d.count)])}
        />
      </div>
    </section>
  );
}

/**
 * How the finished exercises break down by how much work they were.
 *
 * An ordinal scale, so one hue in five steps rather than five different
 * colours: swapping "quick" and "takes a while" would change what the chart
 * means, and the reader should see that order in the colour. Every row is
 * labelled and carries its own count, so nothing here is encoded by colour
 * alone.
 *
 * Horizontal bars because the labels are Hebrew words. Under seven-pixel-wide
 * vertical columns they would collide or have to be rotated, and a rotated
 * label is a label nobody reads.
 */
function DifficultyChart({
  byDifficulty, total,
}: {
  byDifficulty: Record<string, number>;
  total: number;
}) {
  const rows = [
    ...Object.entries(DIFFICULTY).map(([level, band]) => ({
      key: level,
      label: band.label,
      hint: band.hint,
      count: byDifficulty[level] ?? 0,
      className: `rank-${level}`,
    })),
    {
      key: "unrated",
      label: "לא דורג",
      hint: "אף אחד עוד לא שפט את התרגילים האלה",
      count: byDifficulty.unrated ?? 0,
      className: "rank-none",
    },
  ];

  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <section>
      <h2>לפי כמות העבודה</h2>
      <div className="card">
        <div className="chart-rows">
          {rows.map((row) => (
            <div className="chart-row" key={row.key}>
              <span title={row.hint}>{row.label}</span>
              <span className="chart-track">
                <i className={row.className} style={{ width: `${(row.count / max) * 100}%` }} />
              </span>
              <span className="figure faint">{row.count}</span>
            </div>
          ))}
        </div>
        <p className="faint" style={{ marginTop: "var(--s-3)", marginBottom: 0 }}>
          מתוך {total} תרגילים שסימנת.
        </p>
      </div>
    </section>
  );
}

/**
 * The same numbers as a table.
 *
 * Not a fallback for a broken chart — a chart is a shape, and a shape cannot be
 * read aloud, copied, or checked. Collapsed by default so it costs nothing to
 * anyone who does not want it.
 */
function DataTable({
  caption, head, rows,
}: {
  caption: string;
  head: string[];
  rows: string[][];
}) {
  return (
    <details style={{ marginTop: "var(--s-3)" }}>
      <summary>הצג כטבלה</summary>
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
