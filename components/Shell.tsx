"use client";

import Link from "next/link";
import { BarChart3, Camera, ListChecks } from "lucide-react";
import { DIFFICULTY } from "@/lib/worksheet.mjs";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="page">
      <nav className="between" style={{ marginBottom: "var(--s-5)" }}>
        <Link href="/" className="btn btn-quiet" style={{ fontWeight: 700 }}>
          <ListChecks size={18} aria-hidden />
          שיעורי בית
        </Link>
        <span className="row">
          <Link href="/progress" className="btn btn-quiet" aria-label="ההתקדמות שלי">
            <BarChart3 size={18} aria-hidden />
          </Link>
          <Link href="/scan" className="btn btn-primary">
            <Camera size={18} aria-hidden />
            סרוק דף
          </Link>
        </span>
      </nav>
      {children}
    </main>
  );
}

/**
 * The screen a missing environment variable produces.
 *
 * A deployment mistake should read like one sentence somebody can act on, not
 * a blank page or a stack trace, and the rest of the app should keep working
 * around it wherever it can.
 */
export function SetupNotice() {
  return (
    <div className="notice notice-warn stack" role="status">
      <strong>האפליקציה עדיין לא חוברה לשרת.</strong>
      <span className="faint">
        חסרים משתני הסביבה של Supabase. ראה את הקובץ .env.example
      </span>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="row" role="status">
      <span
        className="spin"
        aria-hidden
        style={{
          width: 16,
          height: 16,
          borderRadius: "var(--r-full)",
          border: "2px solid var(--border-strong)",
          borderTopColor: "var(--accent)",
          display: "inline-block",
        }}
      />
      <span className="soft">{label}</span>
    </span>
  );
}

/**
 * A progress bar with its number in text as well as in width.
 *
 * The text is not decoration: a bar alone announces nothing to a screen reader
 * and means nothing to anyone who cannot judge a length at a glance.
 */
export function Bar({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      className={`bar${done === total && total > 0 ? " is-done" : ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label={`${done} מתוך ${total} תרגילים`}
    >
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * How much work an exercise is, as a badge.
 *
 * The wording comes from DIFFICULTY in worksheet.mjs — the same object the
 * prompt's scale is generated from — so the model can never return a level this
 * cannot render, and renaming a band is one edit rather than three.
 *
 * An unrated exercise renders nothing at all. A badge reading "unknown" on
 * every hand-typed row would be noise on the screen where it matters least.
 */
export function DifficultyBadge({ level }: { level: number | null | undefined }) {
  if (level === null || level === undefined) return null;
  const band = DIFFICULTY[level];
  if (!band) return null;

  return (
    <span className="badge badge-quiet" title={band.hint}>
      {band.label}
      <span className="sr-only"> ({band.hint})</span>
    </span>
  );
}
