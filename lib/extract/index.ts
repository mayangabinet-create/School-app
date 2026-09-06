/**
 * A file the student picked, in. Text, out.
 *
 * Everything here is lazy and browser-only. pdf.js and tesseract.js together
 * are several megabytes of JavaScript and WebAssembly, and a student who opens
 * the app to tick two exercises off a list should never pay for either. Both
 * are imported on the first file, not on page load.
 *
 * This module never throws for a reason the student caused. A photograph too
 * dark to read, a PDF with no text layer, a file that turns out to be nothing
 * at all — each of those returns text (possibly empty) and lets the caller
 * decide, because the answer to all of them is the same screen: the manual
 * list, with whatever was read already filled in.
 */

// The OCR core and its language data are fetched at run time from these two
// hosts. If either changes, the Content-Security-Policy in next.config.mjs
// changes in the SAME commit — a policy that has fallen behind its loader does
// not produce an error anyone can read, it produces a page that quietly does
// not work.
const JSDELIVR = "https://cdn.jsdelivr.net";
const TESSDATA = "https://tessdata.projectnaptha.com";

const PDF_WORKER = `${JSDELIVR}/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs`;
const TESS_CORE = `${JSDELIVR}/npm/tesseract.js-core@7.0.0`;
const TESS_WORKER = `${JSDELIVR}/npm/tesseract.js@7.0.0/dist/worker.min.js`;
const TESS_LANGS = `${TESSDATA}/4.0.0`;

/** Both scripts and both languages, so a bilingual worksheet reads. */
const OCR_LANGS = "heb+eng";

/**
 * The page cap is a cost and patience limit, not a technical one. OCR of a
 * scanned page takes seconds; forty of them takes minutes, and nobody
 * photographs forty pages of homework.
 */
export const MAX_PAGES = 40;

/**
 * Below this many characters, a PDF page's text layer is not a text layer —
 * it is a scanned image with a few stray glyphs, and the page needs OCR. A
 * genuinely near-empty page costs one wasted OCR pass and reads the same
 * either way, which is the cheaper mistake to make.
 */
const TEXT_LAYER_MIN_CHARS = 40;

/** Rendering scale for OCR. Below about 2x, Hebrew vowel points blur away. */
const OCR_SCALE = 2;

export type Progress = {
  stage: "reading" | "ocr" | "done";
  page: number;
  pages: number;
  /** 0-100, for a bar. Never NaN, never above 100. */
  percent: number;
};

export type ExtractResult = {
  text: string;
  /** True when at least one page went through OCR, so the caller can warn. */
  usedOcr: boolean;
  pages: number;
  /** True when the document had more pages than MAX_PAGES. */
  pagesDropped: boolean;
};

type OnProgress = (p: Progress) => void;

const report = (fn: OnProgress | undefined, p: Progress) => {
  try {
    fn?.(p);
  } catch {
    // A caller whose progress handler throws must not take the extraction
    // down with it. There is nothing to do about it and nothing to say.
  }
};

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export function isImage(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif)$/i.test(file.name);
}

// ---------------------------------------------------------------- OCR

let ocrWorker: Awaited<ReturnType<typeof makeWorker>> | null = null;

async function makeWorker() {
  const { createWorker } = await import("tesseract.js");
  return createWorker(OCR_LANGS, 1, {
    corePath: TESS_CORE,
    workerPath: TESS_WORKER,
    langPath: TESS_LANGS,
  });
}

/**
 * One worker for the life of the tab. Starting it means downloading and
 * compiling a WebAssembly core and two language files — several seconds and
 * several megabytes — and a student correcting a five-page worksheet should
 * pay that once, not five times.
 */
async function ocrWorkerOnce() {
  if (!ocrWorker) ocrWorker = await makeWorker();
  return ocrWorker;
}

async function ocr(source: Blob | HTMLCanvasElement): Promise<string> {
  try {
    const worker = await ocrWorkerOnce();
    const { data } = await worker.recognize(source);
    return data.text ?? "";
  } catch (err) {
    // A page that would not OCR is a page with no text, not a failed upload.
    // The other pages still count, and the correction screen still opens.
    console.warn("OCR failed for one page:", err);
    return "";
  }
}

// ---------------------------------------------------------------- PDF

async function readPdf(file: File, onProgress?: OnProgress): Promise<ExtractResult> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;

  const buffer = await file.arrayBuffer();
  // The loading task, not the document, owns the worker — tearing down the
  // document alone leaves the worker thread running for the life of the tab.
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const doc = await task.promise;

  const total = doc.numPages;
  const pages = Math.min(total, MAX_PAGES);
  const out: string[] = [];
  let usedOcr = false;

  for (let n = 1; n <= pages; n++) {
    report(onProgress, {
      stage: "reading",
      page: n,
      pages,
      percent: Math.round(((n - 1) / pages) * 100),
    });

    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const layer = content.items
      .map((i) => ("str" in i ? i.str : ""))
      .join(" ")
      .trim();

    if (layer.length >= TEXT_LAYER_MIN_CHARS) {
      out.push(layer);
      page.cleanup();
      continue;
    }

    // No usable text layer: this page is a scan. Render it and read the image.
    report(onProgress, { stage: "ocr", page: n, pages, percent: Math.round(((n - 1) / pages) * 100) });
    usedOcr = true;

    const viewport = page.getViewport({ scale: OCR_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");

    if (context) {
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      out.push(await ocr(canvas));
    }
    // Chromium keeps a canvas's backing store alive until it is collected, and
    // forty full-page canvases at 2x is enough to run a phone out of memory.
    canvas.width = 0;
    canvas.height = 0;
    page.cleanup();
  }

  await task.destroy();
  report(onProgress, { stage: "done", page: pages, pages, percent: 100 });

  return {
    text: out.join("\n\n").trim(),
    usedOcr,
    pages,
    pagesDropped: total > MAX_PAGES,
  };
}

// ---------------------------------------------------------------- entry

export async function extractText(file: File, onProgress?: OnProgress): Promise<ExtractResult> {
  if (isPdf(file)) return readPdf(file, onProgress);

  report(onProgress, { stage: "ocr", page: 1, pages: 1, percent: 0 });
  const text = await ocr(file);
  report(onProgress, { stage: "done", page: 1, pages: 1, percent: 100 });

  return { text: text.trim(), usedOcr: true, pages: 1, pagesDropped: false };
}

/**
 * Give back the worker and its several megabytes once the student has left the
 * scanning screen. Safe to call when none was ever started.
 */
export async function releaseOcr(): Promise<void> {
  const worker = ocrWorker;
  ocrWorker = null;
  try {
    await worker?.terminate();
  } catch {
    // Terminating a worker that has already gone is not a problem worth
    // telling anyone about.
  }
}
