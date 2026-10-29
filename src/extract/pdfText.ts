/**
 * extract/pdfText.ts
 *
 * M2: PDF rendering and text-layer extraction.
 *
 * Responsibilities:
 *  - Load a PDF from an ArrayBuffer using pdfjs-dist.
 *  - Render each page to an OffscreenCanvas (or HTMLCanvasElement) at an
 *    OCR-friendly resolution (≥ 150 DPI equivalent, typically scale ×2).
 *  - Extract text items with their (x, y) coordinates from the text layer.
 *  - Reconstruct table rows by clustering items on similar y-positions rather
 *    than relying on raw PDF stream order — this avoids the "glued row" bug
 *    described in spec §5 where stream order produces strings like
 *    "ICT/23/908 AICT/23/909 B+" instead of two separate rows.
 *  - Parse the sheet header: course code, course name, exam session, date.
 *
 * Per spec §15 M2 Done-when:
 *   "the first sample yields the right set of index numbers, with the
 *   known minus-sign loss visible as text-layer output."
 *
 * NOTE: pdfjs-dist requires a workerSrc to be set before any PDF is loaded.
 * In the browser build this is handled by the app entry point (main.tsx).
 * In Vitest (node environment) the worker is mocked / not required because
 * pdfText.ts exports pure helper functions that Vitest tests directly with
 * synthetic TextItem arrays — no real PDF loading happens in unit tests.
 */

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single text item extracted from a PDF page text layer. */
export interface PdfTextItem {
  /** The string content of this item. */
  str: string;
  /** X coordinate of the item's bounding box (PDF user-space units). */
  x: number;
  /** Y coordinate of the item's bounding box (PDF user-space units).
   *  In PDF coordinate space y grows upward; pdfjs-dist already flips this
   *  to screen-space (y grows downward) when we use the `transform` field.
   */
  y: number;
  /** Width of the item in user-space units. */
  width: number;
  /** Height of the item in user-space units. */
  height: number;
  /** Font size in user-space units. */
  fontSize: number;
}

/** All text items on a single PDF page, plus its rendered image. */
export interface PdfPageData {
  /** 1-based page number. */
  pageNumber: number;
  /** Width of the rendered canvas in pixels. */
  canvasWidth: number;
  /** Height of the rendered canvas in pixels. */
  canvasHeight: number;
  /** ImageData from the rendered canvas (for backward compatibility). */
  imageData: ImageData;
  /** PNG Data URL representing the rendered canvas for Tesseract OCR. */
  imageUrl?: string;
  /** PNG Blob representing the rendered canvas. */
  imageBlob?: Blob;
  /** Raw text items in document stream order. */
  textItems: PdfTextItem[];
  /** Text items grouped into rows by y-position clustering. */
  rows: PdfTextItem[][];
}

/** Metadata extracted from the sheet header area. */
export interface SheetHeader {
  courseCode: string | null;
  courseName: string | null;
  academicYear: number | null;
  semesterNumber: number | null;
  examYear: string | null;
  examSession: string | null;
  /** Date string as printed on the sheet, e.g. "October 2024". */
  date: string | null;
  /** Warning if examination semester could not be determined */
  semesterWarning?: string | null;
  /** Warning if academic year could not be determined from module code */
  academicYearWarning?: string | null;
  /** Official printed student count from PDF summary/footer (e.g. Total: 153). */
  printedTotal?: number | null;
}

/** Full result of processing one PDF file. */
export interface PdfExtractResult {
  pages: PdfPageData[];
  header: SheetHeader;
}

// ---------------------------------------------------------------------------
// Row reconstruction helpers (pure — used directly by Vitest unit tests)
// ---------------------------------------------------------------------------

/**
 * The maximum difference in y-coordinate (in PDF units) for two text items
 * to be considered part of the same row.
 *
 * University result sheets typically use 10–14 pt font and line spacing of
 * ~14–18 pt.  A tolerance of 4 pt correctly merges sub-pixel y-variation
 * within a logical row while splitting items that are on different lines.
 *
 * Exported so tests can assert on the constant value and use it in fixtures.
 */
export const ROW_Y_TOLERANCE = 4; // PDF user-space units (≈ 4 pt)

/**
 * Groups a flat list of text items into rows based on y-position proximity.
 *
 * Algorithm:
 *  1. Sort items by y ascending (top of page first in screen space).
 *  2. Walk through sorted items; start a new row when the y distance from the
 *     current row's representative y exceeds ROW_Y_TOLERANCE.
 *  3. Within each row sort items by x ascending (left to right).
 *
 * This is the fix for the "glued row" problem noted in spec §5:
 *   ICT/23/908 A ICT/23/909 B+  ← stream order (wrong)
 *   Row 1: ICT/23/908 A         ← position-based (correct)
 *   Row 2: ICT/23/909 B+
 *
 * @param items   Raw text items from a single page (any order).
 * @param tolerance  Max y-distance to merge into same row (default: ROW_Y_TOLERANCE).
 * @returns  Array of rows, each row an array of items sorted left-to-right.
 */
export function groupItemsIntoRows(
  items: PdfTextItem[],
  tolerance: number = ROW_Y_TOLERANCE,
): PdfTextItem[][] {
  if (items.length === 0) return [];

  // Sort by y ascending then x ascending as a tie-breaker
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: PdfTextItem[][] = [];
  let currentRowY = sorted[0].y;
  let currentRow: PdfTextItem[] = [];

  for (const item of sorted) {
    if (Math.abs(item.y - currentRowY) <= tolerance) {
      currentRow.push(item);
    } else {
      rows.push(currentRow.sort((a, b) => a.x - b.x));
      currentRow = [item];
      currentRowY = item.y;
    }
  }
  if (currentRow.length > 0) {
    rows.push(currentRow.sort((a, b) => a.x - b.x));
  }

  return rows;
}

/**
 * Joins a row's text items into a single space-separated string,
 * normalising multiple spaces and trimming.
 */
export function rowToString(row: PdfTextItem[]): string {
  return row
    .map((item) => item.str.trim())
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Header parsing helpers (pure — also unit-tested)
// ---------------------------------------------------------------------------

/**
 * Known faculty / degree program prefixes at UoC/UCSC and other technology faculties (spec §5):
 * ICT: Information and Communication Technology
 * ITC: Information Technology and Communication (e.g. ITC1032, ITC2252)
 * IT: Information Technology
 * IS: Information Systems
 * CS: Computer Science
 * SE: Software Engineering
 * ET: Engineering Technology
 * BST: Biosystems Technology
 * AT: Agriculture Technology
 * FOT: Faculty of Technology
 * TG/TI/TEC: Technology faculties
 * AMC/AI/ML/DS: Computing / AI / Data Science
 */
export const VALID_FACULTY_PREFIXES = new Set([
  'ICT', 'ITC', 'IT', 'IS', 'CS', 'SE', 'ET', 'BST', 'AT', 'FOT',
  'TG', 'TI', 'TEC', 'COT', 'AMC', 'AI', 'ML', 'DS', 'BIO', 'MLS',
  'ENG', 'AG', 'CM', 'ENT', 'FST', 'TECH', 'ITM', 'BIT', 'BCS',
  'AS', 'PS', 'MS'
]);

/**
 * Pattern for index numbers (e.g. ICT/23/811, ITC/21/045, 2021/ITC/045, 2020/21/ITC/045).
 */
export const INDEX_NUMBER_PATTERN =
  /(?:\b[A-Z]{2,6}[\/\-_](?:\d{4}[\/\-_]\d{2}|\d{2}[\/\-_]\d{2}|\d{2}|\d{4})[\/\-_]\d{3,5}\b|\b(?:\d{4}[\/\-_]\d{2}|\d{2}[\/\-_]\d{2}|\d{2}|\d{4})[\/\-_][A-Z]{2,6}[\/\-_]\d{3,5}\b|\b[A-Z]{2,6}[\/\-_]?\d{2,4}[\/\-_]?\d{3,5}\b)/i;

/**
 * Patterns to extract the official printed student count / total from the PDF.
 * University result sheets typically print totals like:
 *   "Total: 153 100.0%"
 *   "Total: 100.0% 153"
 *   "Total: 153"
 *   "Total Students: 153"
 *   "Total Candidates: 153"
 *   "Number of Students: 153"
 *   "Number of Candidates: 153"
 */
export const PRINTED_TOTAL_PATTERNS = [
  /\bTotal(?:\s+Students|\s+Candidates)?\s*[:=]?\s*(?:[0-9.]+\s*%\s*)?(\d+)\b/i,
  /\bTotal(?:\s+Students|\s+Candidates)?\s*[:=]?\s*(\d+)(?:\s+[0-9.]+\s*%)?\b/i,
  /\bNumber\s+of\s+(?:Students|Candidates)\s*[:=]?\s*(\d+)\b/i,
];

/**
 * Extracts the official printed student total from raw text if present.
 * @returns Parsed positive integer count, or null if not found.
 */
export function extractPrintedTotal(text: string): number | null {
  if (!text) return null;
  for (const pattern of PRINTED_TOTAL_PATTERNS) {
    const match = pattern.exec(text);
    if (match && match[1]) {
      const val = parseInt(match[1], 10);
      if (!isNaN(val) && val > 0 && val < 10000) {
        return val;
      }
    }
  }
  return null;
}

/**
 * Loose regex for a course code of the form IIC2242, IC3433, IN3462, etc.
 * Also handles a space after the prefix: "IIC 2242".
 */
const COURSE_CODE_RE = /\b([A-Z]{2,4})\s*(\d{4})\b/;

/**
 * Extracts the academic year (1, 2, 3, 4, etc.) from a module code.
 *
 * Rule: Determine academic year from the first digit of the module code's
 * numeric portion after the module prefix.
 *
 * Examples:
 *   "ITC 1052" -> 1
 *   "IIC 2172" -> 2
 *   "IC 3341"  -> 3
 *   "IN 4462"  -> 4
 *
 * Normalizes module codes by removing unnecessary spaces before processing.
 * Does NOT use the module code to determine the semester number.
 *
 * @returns 1, 2, 3, 4, or null if the academic year cannot be derived.
 */
export function extractAcademicYear(moduleCode: string | null | undefined): number | null {
  if (!moduleCode) return null;
  // Normalize module code by removing spaces and hyphens
  const clean = moduleCode.trim().toUpperCase().replace(/[\s\-_]+/g, '');
  // Match prefix of 1-6 letters followed by digits
  const m = clean.match(/^[A-Z]{1,6}(\d)/);
  if (!m) {
    const fallbackMatch = clean.match(/[A-Z]+(\d)/);
    if (!fallbackMatch) return null;
    const digit = parseInt(fallbackMatch[1], 10);
    return digit >= 1 && digit <= 5 ? digit : null;
  }
  const digit = parseInt(m[1], 10);
  return digit >= 1 && digit <= 5 ? digit : null;
}

export interface SemesterHeadingResult {
  semesterNumber: number | null;
  examYear: string | null;
  examSession: string | null;
  matchedText: string | null;
}

const SEMESTER_WORD_MAP: Record<string, { num: number; name: string }> = {
  first: { num: 1, name: 'First Semester' },
  '1st': { num: 1, name: 'First Semester' },
  '1': { num: 1, name: 'First Semester' },
  i: { num: 1, name: 'First Semester' },
  second: { num: 2, name: 'Second Semester' },
  '2nd': { num: 2, name: 'Second Semester' },
  '2': { num: 2, name: 'Second Semester' },
  ii: { num: 2, name: 'Second Semester' },
  third: { num: 3, name: 'Third Semester' },
  '3rd': { num: 3, name: 'Third Semester' },
  '3': { num: 3, name: 'Third Semester' },
  iii: { num: 3, name: 'Third Semester' },
  fourth: { num: 4, name: 'Fourth Semester' },
  '4th': { num: 4, name: 'Fourth Semester' },
  '4': { num: 4, name: 'Fourth Semester' },
  iv: { num: 4, name: 'Fourth Semester' },
};

// "First Semester Examination in 2025", "Second Semester Examination - 2024/2025", "1st Semester 2024"
const PATTERN_SEMESTER_FIRST =
  /\b(First|Second|Third|Fourth|1st|2nd|3rd|4th|[1-4])\s+Semester(?:\s+Examination[s]?)?(?:\s*(?:in|of|for|[-–—:,/])\s*|\s+)(\d{4}(?:[\/\-]\d{2,4})?)\b/i;

// "Semester 1 Examination in 2025", "Semester II 2024/2025"
const PATTERN_SEMESTER_SECOND =
  /\bSemester\s+(First|Second|Third|Fourth|1st|2nd|3rd|4th|[1-4]|I{1,3}|IV)(?:\s+Examination[s]?)?(?:\s*(?:in|of|for|[-–—:,/])\s*|\s+)(\d{4}(?:[\/\-]\d{2,4})?)\b/i;

// "Examination in 2025 - First Semester"
const PATTERN_EXAM_FIRST =
  /\bExamination[s]?(?:\s*(?:in|of|for|[-–—:,/])\s*|\s+)(\d{4}(?:[\/\-]\d{2,4})?)\b.*?\b(First|Second|Third|Fourth|1st|2nd|3rd|4th|[1-4]|I{1,3}|IV)\s+Semester\b/i;

/**
 * Parses examination semester and year from an examination heading string.
 *
 * Examples:
 *   "First Semester Examination in 2025"  -> { semesterNumber: 1, examYear: '2025', examSession: 'First Semester 2025' }
 *   "Second Semester Examination in 2025" -> { semesterNumber: 2, examYear: '2025', examSession: 'Second Semester 2025' }
 *   "Second Semester 2024/2025"           -> { semesterNumber: 2, examYear: '2024/2025', examSession: 'Second Semester 2024/2025' }
 */
export function parseSemesterHeading(text: string): SemesterHeadingResult {
  if (!text) {
    return { semesterNumber: null, examYear: null, examSession: null, matchedText: null };
  }

  // 1. Try Pattern 1: "(First|Second|...) Semester [Examination] [in|-] (YYYY[/YYYY])"
  let m = PATTERN_SEMESTER_FIRST.exec(text);
  if (m) {
    const rawSem = m[1].toLowerCase();
    const semInfo = SEMESTER_WORD_MAP[rawSem];
    const semNum = semInfo ? semInfo.num : null;
    const examYear = m[2];
    const examSession = m[0].trim();
    return {
      semesterNumber: semNum,
      examYear,
      examSession,
      matchedText: m[0].trim(),
    };
  }

  // 2. Try Pattern 2: "Semester (1|2|I|II|First|Second) [Examination] [in|-] (YYYY[/YYYY])"
  m = PATTERN_SEMESTER_SECOND.exec(text);
  if (m) {
    const rawSem = m[1].toLowerCase();
    const semInfo = SEMESTER_WORD_MAP[rawSem];
    const semNum = semInfo ? semInfo.num : null;
    const examYear = m[2];
    const examSession = m[0].trim();
    return {
      semesterNumber: semNum,
      examYear,
      examSession,
      matchedText: m[0].trim(),
    };
  }

  // 3. Try Pattern 3: "Examination [in] (YYYY) ... (First|Second) Semester"
  m = PATTERN_EXAM_FIRST.exec(text);
  if (m) {
    const examYear = m[1];
    const rawSem = m[2].toLowerCase();
    const semInfo = SEMESTER_WORD_MAP[rawSem];
    const semNum = semInfo ? semInfo.num : null;
    const examSession = m[0].trim();
    return {
      semesterNumber: semNum,
      examYear,
      examSession,
      matchedText: m[0].trim(),
    };
  }

  // 4. Fallback: line contains Semester token and a 4-digit year token
  const semMatch =
    /\b(First|Second|Third|Fourth|1st|2nd|3rd|4th)\s+Semester\b/i.exec(text) ||
    /\bSemester\s+(First|Second|Third|Fourth|1st|2nd|3rd|4th|[1-4]|I{1,3}|IV)\b/i.exec(text);
  const yearMatch = /\b(\d{4}(?:[\/\-]\d{2,4})?)\b/.exec(text);

  if (semMatch) {
    const rawSem = semMatch[1].toLowerCase();
    const semInfo = SEMESTER_WORD_MAP[rawSem];
    const semNum = semInfo ? semInfo.num : null;
    const semName = semInfo ? semInfo.name : `${semMatch[1]} Semester`;
    const examYear = yearMatch ? yearMatch[1] : null;
    const examSession = examYear ? `${semName} ${examYear}` : semName;
    return {
      semesterNumber: semNum,
      examYear,
      examSession,
      matchedText: semMatch[0].trim(),
    };
  }

  return { semesterNumber: null, examYear: null, examSession: null, matchedText: null };
}

/**
 * Date patterns found in sheet headers, e.g. "October 2024", "2024-10", "10/2024".
 */
const DATE_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i;

/**
 * Parses sheet-header metadata from the text rows of the first 1–2 pages.
 *
 * Strategy:
 *  - The course code is typically on its own line or alongside the course name.
 *  - Exam session and date are in header rows above the student data table.
 *  - We scan all rows from the top and stop once we've collected all four fields
 *    or we hit a row that contains an index number (start of data).
 *
 * @param rows  Position-grouped rows from the first page (or pages).
 * @returns     Parsed header fields (null for anything not found).
 */
export function parseSheetHeader(rows: PdfTextItem[][]): SheetHeader {
  let courseCode: string | null = null;
  let courseName: string | null = null;
  let semesterNumber: number | null = null;
  let examYear: string | null = null;
  let examSession: string | null = null;
  let date: string | null = null;
  let printedTotal: number | null = null;

  for (const row of rows) {
    const text = rowToString(row);

    if (printedTotal === null) {
      printedTotal = extractPrintedTotal(text);
    }

    // Stop header field extraction once we hit student data rows
    if (INDEX_NUMBER_PATTERN.test(text)) continue;

    if (examSession === null) {
      const heading = parseSemesterHeading(text);
      if (heading.examSession) {
        semesterNumber = heading.semesterNumber;
        examYear = heading.examYear;
        examSession = heading.examSession;
      }
    }

    if (date === null) {
      const m = DATE_RE.exec(text);
      if (m) date = m[0].trim();
    }

    if (courseCode === null) {
      const m = COURSE_CODE_RE.exec(text);
      if (m) {
        // Normalise: remove any internal space → "IIC2242"
        courseCode = (m[1] + m[2]).toUpperCase();
        // The course name is the rest of the line after the code
        const afterCode = text.slice(text.indexOf(m[0]) + m[0].length).trim();
        if (afterCode.length > 0) {
          courseName = afterCode;
        }
      }
    }
  }

  // Derive academic year from module code (Requirement 1)
  const academicYear = extractAcademicYear(courseCode);

  const semesterWarning = !examSession
    ? 'Examination semester heading could not be identified from the PDF. Please assign the semester manually.'
    : null;

  const academicYearWarning = courseCode && academicYear === null
    ? `Academic year could not be determined from module code "${courseCode}".`
    : null;

  return {
    courseCode,
    courseName,
    academicYear,
    semesterNumber,
    examYear,
    examSession,
    date,
    printedTotal,
    semesterWarning,
    academicYearWarning,
  };
}

/**
 * Parses header information (course code, name, exam session, date) from raw
 * text lines (e.g. from OCR fullText of the first page).
 */
export function parseHeaderFromText(text: string): SheetHeader {
  let courseCode: string | null = null;
  let courseName: string | null = null;
  let semesterNumber: number | null = null;
  let examYear: string | null = null;
  let examSession: string | null = null;
  let date: string | null = null;
  const printedTotal: number | null = extractPrintedTotal(text);

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (INDEX_NUMBER_PATTERN.test(line)) continue;

    if (examSession === null) {
      const heading = parseSemesterHeading(line);
      if (heading.examSession) {
        semesterNumber = heading.semesterNumber;
        examYear = heading.examYear;
        examSession = heading.examSession;
      }
    }

    if (date === null) {
      const m = DATE_RE.exec(line);
      if (m) date = m[0].trim();
    }

    if (courseCode === null) {
      const m = COURSE_CODE_RE.exec(line);
      if (m) {
        courseCode = (m[1] + m[2]).toUpperCase();
        const afterCode = line.slice(line.indexOf(m[0]) + m[0].length).trim();
        if (afterCode.length > 0) courseName = afterCode;
      }
    }
  }

  // Derive academic year from module code (Requirement 1)
  const academicYear = extractAcademicYear(courseCode);

  const semesterWarning = !examSession
    ? 'Examination semester heading could not be identified from the PDF. Please assign the semester manually.'
    : null;

  const academicYearWarning = courseCode && academicYear === null
    ? `Academic year could not be determined from module code "${courseCode}".`
    : null;

  return {
    courseCode,
    courseName,
    academicYear,
    semesterNumber,
    examYear,
    examSession,
    date,
    printedTotal,
    semesterWarning,
    academicYearWarning,
  };
}

// ---------------------------------------------------------------------------
// Normalise index numbers
// ---------------------------------------------------------------------------

/**
 * Normalises an index number token to canonical "PREFIX/YY/NNN" form.
 * Handles common OCR/text-layer variants:
 *   "ICT23/811", "ICT 23 811", "ICT/23/811", "ict/23/811"
 *   "ITC/21/045", "2021/ITC/045", "ITC21045", "ITC/2021/045"
 *
 * Returns null if the token cannot be normalised to the pattern.
 */
export function normaliseIndexNumber(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;

  // Strip enclosing quotes, brackets, and extra punctuation
  s = s.replace(/^[\([<{'"|\s]+/, '').replace(/[\)\]>}'"|.,;\s]+$/, '');
  // Normalize OCR misrecognition of 'ICT' where leading 'I' is read as '|', '1', '/', 'l' or omitted
  s = s.replace(/^[|1\/L]CT/, 'ICT');
  if (/^CT\d{5}$/.test(s) || /^CT[\/\-_.]\d{2,4}[\/\-_.]\d{3}$/.test(s)) {
    s = 'I' + s;
  }

  // Clean common OCR noise on scanned result sheets:
  // 1. Strip leading serial numbers (e.g. "1.ITC/21/045" -> "ITC/21/045")
  s = s.replace(/^[0-9]{1,3}[\.\s]+([A-Z])/, '$1');
  // 2. Normalise OCR slash substitutes: |, \, —, –, /
  s = s.replace(/[|\\\-_]+/g, '/');
  // 3. Normalise letter O in year part: /2O/ -> /20/
  s = s.replace(/\/2[O]\//g, '/20/');
  // 4. Normalise letter O in sequence part: /O45 -> /045
  s = s.replace(/\/([O0-9]{1,5})$/, (_match, seq) => '/' + seq.replace(/O/g, '0'));

  // Dual academic year format: e.g. "2020/21/ITC/045", "19/20/ITC/045", "ITC/2020/21/045", "ITC/19/20/045"
  const dualYearMatch1 = /^(\d{2,4})[\/\-_](\d{2})[\/\-_]([A-Z]{1,6})[\/\-_](\d{1,5})$/.exec(s);
  if (dualYearMatch1) {
    const [, yr1, , prefix, seq] = dualYearMatch1;
    if (!VALID_FACULTY_PREFIXES.has(prefix)) return null;
    const yy = yr1.slice(-2);
    const paddedSeq = seq.length <= 3 ? seq.padStart(3, '0') : seq.replace(/^0+/, '').padStart(3, '0');
    if (paddedSeq.length !== 3) return null;
    return `${prefix}/${yy}/${paddedSeq}`;
  }

  const dualYearMatch2 = /^([A-Z]{1,6})[\/\-_](\d{2,4})[\/\-_](\d{2})[\/\-_](\d{1,5})$/.exec(s);
  if (dualYearMatch2) {
    const [, prefix, yr1, , seq] = dualYearMatch2;
    if (!VALID_FACULTY_PREFIXES.has(prefix)) return null;
    const yy = yr1.slice(-2);
    const paddedSeq = seq.length <= 3 ? seq.padStart(3, '0') : seq.replace(/^0+/, '').padStart(3, '0');
    if (paddedSeq.length !== 3) return null;
    return `${prefix}/${yy}/${paddedSeq}`;
  }

  // Format 1: Prefix first, e.g. "ICT/23/811", "ITC/21/045", "ICT23811", "ITC21/045", "ITC/2021/045", "ITC/21/0045"
  const prefixMatch = /^([A-Z]{1,6})[\/\-_]?(\d{2}|\d{4})[\/\-_]?(\d{1,5})$/.exec(s);
  if (prefixMatch) {
    const [, prefix, yearStr, seq] = prefixMatch;
    if (!VALID_FACULTY_PREFIXES.has(prefix)) return null;
    if (seq.length < 3) return null;
    const yy = yearStr.length === 4 ? yearStr.slice(-2) : yearStr;
    const paddedSeq = seq.length > 3 && seq.startsWith('0') ? seq.replace(/^0+/, '').padStart(3, '0') : seq;
    if (paddedSeq.length !== 3) return null;
    return `${prefix}/${yy}/${paddedSeq}`;
  }

  // Format 2: Year first, e.g. "2021/ITC/045", "21/ITC/045", "2023/ICT/811", "2021/ITC/0045"
  const yearFirstMatch = /^(\d{2}|\d{4})[\/\-_]?([A-Z]{1,6})[\/\-_]?(\d{1,5})$/.exec(s);
  if (yearFirstMatch) {
    const [, yearStr, prefix, seq] = yearFirstMatch;
    if (!VALID_FACULTY_PREFIXES.has(prefix)) return null;
    if (seq.length < 3) return null;
    const yy = yearStr.length === 4 ? yearStr.slice(-2) : yearStr;
    const paddedSeq = seq.length > 3 && seq.startsWith('0') ? seq.replace(/^0+/, '').padStart(3, '0') : seq;
    if (paddedSeq.length !== 3) return null;
    return `${prefix}/${yy}/${paddedSeq}`;
  }

  return null;
}

/**
 * Validates a normalised index number against the PREFIX/yy/nnn pattern.
 * Per spec §5.
 *
 * @returns true if valid.
 */
export function validateIndexNumber(normalised: string): boolean {
  if (!normalised) return false;
  const m = /^([A-Z]{1,6})\/(\d{2})\/(\d{3})$/.exec(normalised.trim());
  if (!m) return false;
  return VALID_FACULTY_PREFIXES.has(m[1]);
}

// ---------------------------------------------------------------------------
// PDF loading and rendering (browser-only — guarded by typeof document)
// ---------------------------------------------------------------------------

/**
 * Loads a PDF from an ArrayBuffer and extracts text items with positions
 * and a rendered ImageData for each page.
 *
 * This function is intentionally browser-only (it needs OffscreenCanvas /
 * HTMLCanvasElement and pdfjs-dist's browser worker).  Vitest tests do NOT
 * call this function directly — they test the pure helpers above.
 *
 * @param buffer       ArrayBuffer from a File object.
 * @param renderScale  Canvas render scale relative to CSS px.
 *                     2.0 (≈150 DPI on a 96 DPI display) is the OCR minimum.
 * @param onProgress   Optional callback(currentPage, totalPages).
 */
/**
 * Returns the resolved Vite worker asset URL for PDF.js.
 */
export function getPdfWorkerUrl(): string {
  return pdfWorkerUrl;
}

/**
 * Ensures PDF.js workerSrc is configured correctly with the Vite-compatible worker URL.
 * In browser environments, sets GlobalWorkerOptions.workerSrc.
 * Returns the configured workerSrc string.
 */
export async function ensurePdfWorker(workerUrl?: string): Promise<string> {
  const url = workerUrl || pdfWorkerUrl;
  if (typeof window !== 'undefined') {
    const pdfjsLib = await import('pdfjs-dist');
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = url;
    }
    return pdfjsLib.GlobalWorkerOptions.workerSrc;
  }
  return url;
}

export async function extractPdfPages(
  buffer: ArrayBuffer,
  renderScale = 2.0,
  onProgress?: (current: number, total: number) => void,
): Promise<PdfExtractResult> {
  // Dynamic import to allow Vitest (node env) to import the module without
  // pdfjs-dist attempting to load a DOM worker.
  const pdfjsLib = await import('pdfjs-dist');

  // Configure workerSrc before any PDF document is loaded (spec M2 / Vite setup)
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  }

  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const pages: PdfPageData[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    onProgress?.(pageNum, totalPages);

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: renderScale });

    // ── Render to canvas ──────────────────────────────────────────────────
    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);
    let imageData: ImageData;
    let imageUrl = '';
    let imageBlob: Blob | undefined;

    if (typeof OffscreenCanvas !== 'undefined') {
      // Worker-friendly path
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      // Pre-fill solid white background so transparent PDF areas do not invert or corrupt OCR
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;

      imageData = ctx.getImageData(0, 0, width, height);
      try {
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        imageBlob = blob;
        imageUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string) || '');
          reader.readAsDataURL(blob);
        });
      } catch {
        // Fallback if convertToBlob fails
      }
    } else if (typeof document !== 'undefined') {
      // Fallback for main thread
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      imageData = ctx.getImageData(0, 0, width, height);
      try {
        imageUrl = canvas.toDataURL('image/png');
      } catch {
        // Fallback
      }
    } else {
      // Headless / node mock
      imageData = {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
        colorSpace: 'srgb',
      } as ImageData;
    }

    // ── Extract text layer ─────────────────────────────────────────────────
    const textContent = await page.getTextContent();

    const textItems: PdfTextItem[] = textContent.items
      .filter((item): item is import('pdfjs-dist/types/src/display/api').TextItem =>
        'str' in item && typeof (item as { str: unknown }).str === 'string',
      )
      .map((item) => {
        // item.transform is a 6-element array [a,b,c,d,e,f] (affine transform)
        // e = x translation, f = y translation in PDF user-space (y-up).
        // We convert to screen-space y (y-down) via: screenY = viewport.height - f
        // so that row grouping works in a consistent top-down coordinate system.
        const [, , , , tx, ty] = item.transform as number[];
        const screenY = viewport.height / renderScale - ty;
        return {
          str: item.str,
          x: tx,
          y: screenY,
          width: item.width ?? 0,
          height: item.height ?? 0,
          fontSize: item.transform ? Math.abs((item.transform as number[])[3]) : 0,
        };
      });

    const rows = groupItemsIntoRows(textItems, 6);

    pages.push({
      pageNumber: pageNum,
      canvasWidth: width,
      canvasHeight: height,
      imageData,
      imageUrl,
      imageBlob,
      textItems,
      rows,
    });

    // Release page resources
    page.cleanup();
  }

  // Parse header across document pages (search beyond page 1 if heading or course code is on a later page)
  let header = parseSheetHeader(pages[0]?.rows ?? []);
  for (let p = 1; p < pages.length; p++) {
    const pageHeader = parseSheetHeader(pages[p].rows);
    header = {
      courseCode: header.courseCode || pageHeader.courseCode,
      courseName: header.courseName || pageHeader.courseName,
      academicYear: header.academicYear ?? pageHeader.academicYear,
      semesterNumber: header.semesterNumber ?? pageHeader.semesterNumber,
      examYear: header.examYear ?? pageHeader.examYear,
      examSession: header.examSession || pageHeader.examSession,
      date: header.date || pageHeader.date,
      printedTotal: header.printedTotal ?? pageHeader.printedTotal,
      semesterWarning: (header.examSession || pageHeader.examSession) ? null : header.semesterWarning,
      academicYearWarning: (header.academicYear ?? pageHeader.academicYear) ? null : header.academicYearWarning,
    };
  }

  // Also scan all text items across all pages for printed total if not yet found
  if (!header.printedTotal) {
    for (const page of pages) {
      for (const row of page.rows) {
        const total = extractPrintedTotal(rowToString(row));
        if (total !== null) {
          header.printedTotal = total;
          break;
        }
      }
      if (header.printedTotal) break;
    }
  }

  return { pages, header };
}
