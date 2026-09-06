/**
 * Worksheets to measure the offline splitter against.
 *
 * An honest caveat that belongs next to any number these produce: these pages
 * were written to exercise the splitter, not sampled from real classrooms. They
 * cover the shapes and the failure modes deliberately, which makes them useful
 * for catching regressions and NOT a measurement of how the splitter does on
 * whatever a real student photographs. Only real pages can tell us that.
 *
 * Two counts, deliberately kept apart, because collapsing them into one is how
 * a measurement flatters itself:
 *
 *   `exercises`    how many exercises the PAGE actually has. Sub-parts (א, ב, ג
 *                  under an exercise) are not exercises and must not become rows.
 *   `split`        how many the offline splitter is expected to return. Where
 *                  this is lower than `exercises`, the page is one the splitter
 *                  cannot do alone — which is the whole case for keeping a model
 *                  behind it, and must not be scored as a pass.
 */

export const WORKSHEETS = [
  {
    name: "numbered, clean",
    exercises: 4,
    split: 4,
    text: `דף עבודה — משוואות ממעלה ראשונה

1. פתור: 2x + 5 = 13
2. פתור: 3(x - 4) = 9
3. אם 5x = 45, מהו x?
4. פתור: (x + 2)/3 = 4`,
  },

  {
    name: "numbered with Hebrew sub-parts",
    exercises: 3,
    split: 3,
    text: `1. נתון מלבן שאורכו x+3 ורוחבו 4.
   א. כתוב ביטוי לשטח
   ב. אם השטח 32, מצא את x
2. נתון משולש ישר זווית, ניצביו 6 ו-8.
   א. חשב את היתר
   ב. חשב את ההיקף
   ג. חשב את השטח
3. פתור את המערכת: x + y = 10, x - y = 2`,
  },

  {
    name: "Hebrew letter enumeration only",
    exercises: 5,
    split: 5,
    text: `פתרו את התרגילים הבאים

א. 12 + 7 =
ב. 45 - 18 =
ג. 6 × 9 =
ד. 72 ÷ 8 =
ה. 15 + 24 - 9 =`,
  },

  {
    name: "keyword enumeration",
    exercises: 3,
    split: 3,
    text: `תרגיל 1 — חשב את שטח המעגל שרדיוסו 5 סמ.

תרגיל 2 — חשב את היקף המעגל שרדיוסו 5 סמ.

תרגיל 3 — מעגל ששטחו 78.5 סמ רבוע. מהו הרדיוס?`,
  },

  {
    name: "OCR mangled one marker",
    exercises: 5,
    split: 4,
    // The "3." came back as "З." (a Cyrillic capital Ze). Five exercises are on
    // the page and the splitter returns four: the third merges into the second.
    // The right shape of failure — nothing is lost and the student sees it on
    // the correction screen — but still a miss, and counted as one.
    text: `1. פתור: x + 4 = 9
2. פתור: x - 7 = 2
З. פתור: 2x = 14
4. פתור: x/3 = 5
5. פתור: 3x + 1 = 10`,
  },

  {
    name: "page number, class number and a year present",
    exercises: 3,
    split: 3,
    text: `בית ספר תיכון, כיתה ט3
היסטוריה — דף עבודה

1. מה קרה בשנת 1948?
2. מי היה ראש הממשלה הראשון?
3. בשנת 1967 התרחשה מלחמה. איזו?

2`,
  },

  {
    name: "prices and decimals that look like markers",
    exercises: 3,
    split: 3,
    text: `1. מחיר המוצר 12.50 שקלים. כמה יעלו 4 מוצרים?
2. 3.14 הוא קירוב לפאי. חשב שטח מעגל שרדיוסו 2.
3. משקל השקית 1.5 קילוגרם. כמה שוקלות 6 שקיות?`,
  },

  {
    name: "answer key repeated at the bottom",
    exercises: 4,
    split: 4,
    text: `1. 5 + 3 =
2. 9 - 4 =
3. 6 × 7 =
4. 81 ÷ 9 =

תשובות
1. 8
2. 5
3. 42
4. 9`,
  },

  {
    name: "two columns read one after the other",
    exercises: 12,
    split: 12,
    text: [...Array(12)].map((_, i) => `${i + 1}. חשב: ${i + 2} × ${i + 3} =`).join("\n"),
  },

  {
    name: "English worksheet",
    exercises: 4,
    split: 4,
    text: `Algebra practice sheet

1) Solve for x: 2x + 5 = 13
2) Solve for x: 3(x - 4) = 9
3) If 5x = 45, what is x?
4) Solve: (x + 2)/3 = 4`,
  },

  {
    name: "unnumbered prose questions",
    exercises: 3,
    split: 0,
    // Three real questions, and nothing on the page says where any of them
    // begins. The splitter must return nothing rather than invent boundaries.
    // This is the page the model is for, and the reason it stays.
    text: `ענו על השאלות הבאות במחברת.

הסבירו מדוע המים מרתיחים ב-100 מעלות בלחץ אטמוספרי רגיל.

מה ההבדל בין אידוי לרתיחה? תנו דוגמה לכל אחד מהם.

תארו ניסוי שבודק את השפעת הלחץ על נקודת הרתיחה.`,
  },

  {
    name: "a single exercise",
    exercises: 1,
    split: 0,
    // One real exercise. One marker is not a numbering, so the splitter
    // declines: splitting here would produce a one-row list that is just the
    // page with its first line removed.
    text: `1. פתור את המשוואה הבאה והסבר כל שלב:
   2(x + 3) - 4 = 3x - 1`,
  },

  {
    name: "table of contents style header",
    exercises: 4,
    split: 4,
    text: `נושאים בדף: משוואות, אי-שוויונות

1. פתור: x + 1 = 5
2. פתור: x + 2 = 7
3. פתור: x + 3 = 9
4. פתור: x + 4 = 11`,
  },

  {
    name: "empty page",
    exercises: 0,
    split: 0,
    text: "",
  },
];
