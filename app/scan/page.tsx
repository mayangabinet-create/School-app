"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, ArrowDown, ArrowUp, Camera, Check, FileText,
  PencilLine, Plus, Trash2, WandSparkles,
} from "lucide-react";
import { Shell, SetupNotice, Spinner } from "@/components/Shell";
import { isConfigured } from "@/lib/supabase/client";
import { extractText, isPdf, releaseOcr, MAX_PAGES, type Progress } from "@/lib/extract";
import { extractExercises } from "@/lib/ai";
import { createAssignment, type SourceKind } from "@/lib/data";
import { calendarDay } from "@/lib/pace.mjs";
import { QUOTAS } from "@/lib/policy.mjs";

type Stage = "pick" | "reading" | "thinking" | "correct" | "saving";

type Draft = { key: string; label: string; text: string; uncertain: boolean };

let nextKey = 0;
const freshKey = () => `row-${nextKey++}`;
const blankRow = (): Draft => ({ key: freshKey(), label: "", text: "", uncertain: false });

export default function ScanPage() {
  return (
    <Suspense fallback={<Shell><Spinner label="טוען…" /></Shell>}>
      <Scan />
    </Suspense>
  );
}

function Scan() {
  const router = useRouter();
  const params = useSearchParams();
  const startManual = params.get("manual") === "1";

  const [stage, setStage] = useState<Stage>(startManual ? "correct" : "pick");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rows, setRows] = useState<Draft[]>(startManual ? [blankRow()] : []);
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [sourceKind, setSourceKind] = useState<SourceKind>("manual");
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  // Several megabytes of OCR core and language data stay resident once
  // started. Give them back when the student leaves this screen.
  useEffect(() => () => void releaseOcr(), []);

  /**
   * The whole of phase one, in one function.
   *
   * Every branch out of it ends in the same place: the correction screen. A
   * photograph too dark to read, a model that returned nothing, a network that
   * died mid-call — none of those is a dead end, because the student still has
   * the page in front of them and can type. The one outcome that must never
   * happen is an empty screen with nothing to do next.
   */
  const handleFile = useCallback(async (file: File) => {
    const kind: SourceKind = isPdf(file) ? "pdf" : "photo";
    setSourceKind(kind);
    setNotice(null);
    setTitle((current) => current || file.name.replace(/\.[^.]+$/, ""));

    setStage("reading");
    setProgress({ stage: "reading", page: 0, pages: 1, percent: 0 });

    let text = "";
    let warning: string | null = null;

    try {
      const read = await extractText(file, setProgress);
      text = read.text;
      if (read.pagesDropped) {
        warning = `קראנו את ${MAX_PAGES} העמודים הראשונים בלבד. את השאר אפשר להוסיף בדף נפרד.`;
      }
    } catch (err) {
      console.error("extraction failed:", err);
      warning = "לא הצלחנו לקרוא את הקובץ. אפשר להקליד את התרגילים ידנית.";
    }

    if (!text.trim()) {
      setNotice(warning ?? "לא יצא טקסט מהקובץ. אולי הצילום מטושטש. אפשר להקליד ידנית.");
      setRows([blankRow()]);
      setStage("correct");
      return;
    }

    setStage("thinking");
    const outcome = await extractExercises(text);

    if (!outcome.ok) {
      setNotice(outcome.message);
      setRows([blankRow()]);
      setStage("correct");
      return;
    }

    const found = outcome.items.map((item) => ({
      key: freshKey(),
      label: item.label,
      text: item.text,
      uncertain: item.uncertain,
    }));

    const notices = [warning];
    if (outcome.inputTruncated) {
      notices.push("הדף היה ארוך מדי, אז חלק ממנו לא נקרא. בדוק שכל התרגילים כאן.");
    }
    if (outcome.outputTruncated) {
      notices.push("הרשימה נקטעה באמצע. ייתכן שחסרים התרגילים האחרונים.");
    }
    if (found.length === 0) {
      notices.push("לא זיהינו תרגילים בדף. אפשר להקליד אותם ידנית.");
    }

    setNotice(notices.filter(Boolean).join(" ") || null);
    setRows(found.length ? found : [blankRow()]);
    setStage("correct");
  }, []);

  /**
   * Shared by both file inputs. Clearing the value afterwards matters: a
   * student who retakes a blurry photo often picks the same filename, and an
   * unchanged value fires no change event at all.
   */
  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handleFile(file);
  }, [handleFile]);

  if (!isConfigured()) {
    return <Shell><SetupNotice /></Shell>;
  }

  // ------------------------------------------------------------ picking
  if (stage === "pick") {
    return (
      <Shell>
        <h1>סרוק דף עבודה</h1>
        <p className="soft">
          צלם את הדף או העלה קובץ. התרגילים יהפכו לרשימה, ותוכל לתקן אותה לפני ששומרים.
        </p>

        <div className="stack" style={{ marginTop: "var(--s-5)" }}>
          {/*
            Two inputs, not one with a `capture` attribute.

            `capture` is a hint that the browser should open the camera
            directly, and several Android browsers honour it hard enough that
            the file picker becomes unreachable — which would make the PDF path
            unusable on exactly the devices most likely to use it. Splitting
            them means each button does the one thing its label says.
          */}
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={onPick}
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            onChange={onPick}
          />
          <button className="btn btn-primary btn-block" onClick={() => cameraInput.current?.click()}>
            <Camera size={18} aria-hidden />
            צלם את הדף
          </button>
          <button className="btn btn-block" onClick={() => fileInput.current?.click()}>
            <FileText size={18} aria-hidden />
            העלה קובץ או תמונה
          </button>
          <button className="btn btn-quiet btn-block"
                  onClick={() => { setRows([blankRow()]); setStage("correct"); }}>
            <PencilLine size={18} aria-hidden />
            הקלד את התרגילים ידנית
          </button>
          <p className="faint" style={{ textAlign: "center" }}>
            {QUOTAS.extract.perMonth} סריקות בחודש, {QUOTAS.extract.perDay} ביום. הקלדה ידנית היא ללא הגבלה.
          </p>
        </div>
      </Shell>
    );
  }

  // ------------------------------------------------------------ working
  if (stage === "reading" || stage === "thinking") {
    return (
      <Shell>
        <h1>{stage === "reading" ? "קורא את הדף" : "מזהה את התרגילים"}</h1>
        <div className="card stack">
          <Spinner label={progressLabel(stage, progress)} />
          {stage === "reading" && progress && (
            <div className="bar" role="progressbar" aria-valuenow={progress.percent}
                 aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${progress.percent}%` }} />
            </div>
          )}
          <p className="faint">
            הקריאה קורית במכשיר שלך. אפשר לחכות, וגם אם משהו ישתבש תוכל להקליד ידנית.
          </p>
        </div>
      </Shell>
    );
  }

  // ------------------------------------------------------------ correcting
  return (
    <Correction
      rows={rows}
      setRows={setRows}
      title={title}
      setTitle={setTitle}
      dueOn={dueOn}
      setDueOn={setDueOn}
      notice={notice}
      saving={stage === "saving"}
      onSave={async () => {
        const clean = rows
          .map((r) => ({
            label: r.label.trim() || r.text.trim().slice(0, 60),
            text: r.text.trim(),
            uncertain: r.uncertain,
          }))
          .filter((r) => r.label);

        setStage("saving");
        try {
          const id = await createAssignment({
            title: title.trim() || "שיעורי בית",
            dueOn: dueOn || null,
            sourceKind,
            items: clean,
          });
          router.push(`/assignments/${id}`);
        } catch (err) {
          console.error(err);
          setNotice("השמירה נכשלה. נסה שוב — מה שהקלדת עדיין כאן.");
          setStage("correct");
        }
      }}
    />
  );
}

function progressLabel(stage: Stage, progress: Progress | null): string {
  if (stage === "thinking") return "עוד רגע…";
  if (!progress) return "מתחיל…";
  if (progress.stage === "ocr") return `קורא טקסט מתמונה — עמוד ${progress.page} מתוך ${progress.pages}`;
  return `עמוד ${progress.page} מתוך ${progress.pages}`;
}

/**
 * The correction screen.
 *
 * Not optional and not a fallback. Detection is never perfect — an OCR pass
 * over a photographed page will merge two exercises, split one, or read a 5 as
 * an S — and a checklist the student never checked is a checklist they cannot
 * trust. Rows the model itself flagged as guesses are marked, so the ones most
 * likely to be wrong are the ones the eye lands on first.
 */
function Correction({
  rows, setRows, title, setTitle, dueOn, setDueOn, notice, saving, onSave,
}: {
  rows: Draft[];
  setRows: (rows: Draft[]) => void;
  title: string;
  setTitle: (v: string) => void;
  dueOn: string;
  setDueOn: (v: string) => void;
  notice: string | null;
  saving: boolean;
  onSave: () => void;
}) {
  const today = calendarDay(new Date());
  const filled = rows.filter((r) => r.label.trim() || r.text.trim()).length;
  const uncertain = rows.filter((r) => r.uncertain).length;

  const patch = (key: string, change: Partial<Draft>) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const move = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= rows.length) return;
    const next = rows.slice();
    [next[index], next[to]] = [next[to], next[index]];
    setRows(next);
  };

  return (
    <Shell>
      <h1>בדוק את הרשימה</h1>
      <p className="soft">
        {filled > 0
          ? `זיהינו ${filled} תרגילים. תקן מה שצריך, ואז שמור.`
          : "לא זיהינו כלום. הוסף את התרגילים כאן."}
      </p>

      {notice && (
        <div className="notice notice-warn row" role="status" style={{ marginBottom: "var(--s-4)" }}>
          <AlertTriangle size={18} aria-hidden style={{ flex: "none" }} />
          <span>{notice}</span>
        </div>
      )}

      {uncertain > 0 && (
        <p className="faint row">
          <WandSparkles size={16} aria-hidden />
          {uncertain === 1
            ? "שורה אחת מסומנת כניחוש. כדאי להשוות אותה לדף."
            : `${uncertain} שורות מסומנות כניחוש. כדאי להשוות אותן לדף.`}
        </p>
      )}

      <div className="card stack" style={{ marginBottom: "var(--s-4)" }}>
        <div>
          <label htmlFor="title">שם המטלה</label>
          <input id="title" className="input" value={title} placeholder="דף עבודה — משוואות"
                 onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor="due">להגשה עד</label>
          <input id="due" className="input" type="date" value={dueOn} min={today}
                 onChange={(e) => setDueOn(e.target.value)} />
          <p className="faint" style={{ marginTop: "var(--s-1)" }}>
            בלי תאריך זה בסדר גמור. פשוט לא נחשב כמה לעשות כל יום.
          </p>
        </div>
      </div>

      <div className="stack">
        {rows.map((row, index) => (
          <div key={row.key} className="card stack rise">
            <div className="between">
              <span className="faint figure">{index + 1}</span>
              <div className="row">
                {row.uncertain && (
                  <span className="badge badge-uncertain">ניחוש</span>
                )}
                <button className="btn btn-quiet" onClick={() => move(index, -1)}
                        disabled={index === 0} aria-label={`העבר את שורה ${index + 1} למעלה`}>
                  <ArrowUp size={16} aria-hidden />
                </button>
                <button className="btn btn-quiet" onClick={() => move(index, 1)}
                        disabled={index === rows.length - 1}
                        aria-label={`העבר את שורה ${index + 1} למטה`}>
                  <ArrowDown size={16} aria-hidden />
                </button>
                <button className="btn btn-quiet" onClick={() => setRows(rows.filter((r) => r.key !== row.key))}
                        aria-label={`מחק את שורה ${index + 1}`}>
                  <Trash2 size={16} aria-hidden />
                </button>
              </div>
            </div>

            <input
              className="input"
              value={row.label}
              placeholder="תרגיל 1"
              aria-label={`כותרת לשורה ${index + 1}`}
              onChange={(e) => patch(row.key, { label: e.target.value, uncertain: false })}
            />
            <textarea
              className="textarea"
              value={row.text}
              placeholder="התרגיל עצמו, כפי שהוא כתוב בדף"
              aria-label={`התרגיל בשורה ${index + 1}`}
              onChange={(e) => patch(row.key, { text: e.target.value, uncertain: false })}
            />
          </div>
        ))}
      </div>

      <div className="stack" style={{ marginTop: "var(--s-4)" }}>
        <button className="btn btn-block" onClick={() => setRows([...rows, blankRow()])}>
          <Plus size={18} aria-hidden />
          הוסף תרגיל
        </button>
        <button className="btn btn-primary btn-block" onClick={onSave} disabled={saving || filled === 0}>
          {saving ? <Spinner label="שומר…" /> : (<><Check size={18} aria-hidden />שמור את הרשימה</>)}
        </button>
      </div>
    </Shell>
  );
}
