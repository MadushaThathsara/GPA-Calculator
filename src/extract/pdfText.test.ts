/**
 * extract/pdfText.test.ts
 *
 * Vitest unit tests for M2 — PDF text-layer helpers.
 *
 * Tests cover:
 *  1. groupItemsIntoRows  — the core fix for the "glued row" problem.
 *  2. rowToString         — joins items left-to-right.
 *  3. parseSheetHeader    — extracts course code, name, session, date.
 *  4. normaliseIndexNumber — handles OCR/text-layer artifacts.
 *  5. validateIndexNumber  — pattern ICT/yy/nnn.
 *
 * All tests use synthetic PdfTextItem fixtures (no real PDF needed).
 */

import { describe, it, expect } from 'vitest';
import {
  groupItemsIntoRows,
  rowToString,
  parseSheetHeader,
  normaliseIndexNumber,
  validateIndexNumber,
  ensurePdfWorker,
  extractAcademicYear,
  parseSemesterHeading,
  ROW_Y_TOLERANCE,
  type PdfTextItem,
} from './pdfText';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function item(str: string, x: number, y: number): PdfTextItem {
  return { str, x, y, width: str.length * 6, height: 12, fontSize: 10 };
}

// ---------------------------------------------------------------------------
// 1. groupItemsIntoRows
// ---------------------------------------------------------------------------

describe('groupItemsIntoRows', () => {
  it('returns empty array for no items', () => {
    expect(groupItemsIntoRows([])).toEqual([]);
  });

  it('puts items at the same y into one row', () => {
    const items: PdfTextItem[] = [
      item('ICT/23/811', 50, 100),
      item('A-', 200, 100),
    ];
    const rows = groupItemsIntoRows(items);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(2);
  });

  it('splits items that differ in y by more than ROW_Y_TOLERANCE into separate rows', () => {
    const y1 = 100;
    const y2 = y1 + ROW_Y_TOLERANCE + 1; // just outside tolerance
    const items: PdfTextItem[] = [
      item('ICT/23/908', 50, y1),
      item('A', 200, y1),
      item('ICT/23/909', 50, y2),
      item('B+', 200, y2),
    ];
    const rows = groupItemsIntoRows(items);
    expect(rows).toHaveLength(2);
    expect(rows[0].map((i) => i.str)).toContain('ICT/23/908');
    expect(rows[1].map((i) => i.str)).toContain('ICT/23/909');
  });

  it('merges items within ROW_Y_TOLERANCE into the same row', () => {
    const items: PdfTextItem[] = [
      item('ICT/23/811', 50, 100.0),
      item('A-', 200, 100.0 + ROW_Y_TOLERANCE), // exactly at boundary
    ];
    const rows = groupItemsIntoRows(items);
    expect(rows).toHaveLength(1);
  });

  it('sorts items within a row by x (left to right)', () => {
    const items: PdfTextItem[] = [
      item('B+', 200, 100),
      item('ICT/23/909', 50, 100), // x < 200, should come first
    ];
    const rows = groupItemsIntoRows(items);
    expect(rows[0][0].str).toBe('ICT/23/909');
    expect(rows[0][1].str).toBe('B+');
  });

  it('handles the "glued row" scenario from spec §5', () => {
    // Stream order would give "ICT/23/908 A ICT/23/909 B+" on one line.
    // Position-based grouping must split them.
    const lineSpacing = 14; // typical 14pt line height
    const items: PdfTextItem[] = [
      item('ICT/23/908', 50, 100),
      item('A', 200, 100),
      item('ICT/23/909', 50, 100 + lineSpacing),
      item('B+', 200, 100 + lineSpacing),
    ];
    const rows = groupItemsIntoRows(items);
    expect(rows).toHaveLength(2);
    expect(rowToString(rows[0])).toBe('ICT/23/908 A');
    expect(rowToString(rows[1])).toBe('ICT/23/909 B+');
  });

  it('handles a two-column layout (two students per physical row) with different x values', () => {
    // Some sheets print two students side by side on the same y.
    const items: PdfTextItem[] = [
      item('ICT/23/801', 50, 100),
      item('A+', 150, 100),
      item('ICT/23/802', 300, 100),
      item('B', 400, 100),
    ];
    const rows = groupItemsIntoRows(items);
    // They share the same y, so they are ONE row in the text layer.
    // Column splitting is done at the reconcile level; here we just confirm
    // all 4 items are in the same row.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(4);
    // Left-to-right ordering
    expect(rows[0].map((i) => i.str)).toEqual(['ICT/23/801', 'A+', 'ICT/23/802', 'B']);
  });

  it('produces rows sorted by y (top of page first)', () => {
    const items: PdfTextItem[] = [
      item('Last', 50, 300),
      item('Middle', 50, 200),
      item('First', 50, 100),
    ];
    const rows = groupItemsIntoRows(items);
    expect(rows[0][0].str).toBe('First');
    expect(rows[1][0].str).toBe('Middle');
    expect(rows[2][0].str).toBe('Last');
  });

  it('respects a custom tolerance parameter', () => {
    const items: PdfTextItem[] = [
      item('A', 50, 100),
      item('B', 50, 108), // 8 units apart — outside default tolerance of 4
    ];
    const rowsDefault = groupItemsIntoRows(items);
    expect(rowsDefault).toHaveLength(2);

    const rowsCustom = groupItemsIntoRows(items, 10); // custom tolerance = 10
    expect(rowsCustom).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. rowToString
// ---------------------------------------------------------------------------

describe('rowToString', () => {
  it('joins items with a single space', () => {
    const row = [item('ICT/23/811', 50, 100), item('A-', 200, 100)];
    expect(rowToString(row)).toBe('ICT/23/811 A-');
  });

  it('trims whitespace from individual items', () => {
    const row = [
      { ...item('  ICT/23/811  ', 50, 100) },
      { ...item('  B+  ', 200, 100) },
    ];
    expect(rowToString(row)).toBe('ICT/23/811 B+');
  });

  it('filters out empty items', () => {
    const row = [item('', 50, 100), item('A', 200, 100), item('', 300, 100)];
    expect(rowToString(row)).toBe('A');
  });

  it('returns empty string for an empty row', () => {
    expect(rowToString([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 3. parseSheetHeader
// ---------------------------------------------------------------------------

describe('parseSheetHeader', () => {
  function makeRow(text: string, y: number): PdfTextItem[] {
    return text.split(/\s+/).map((word, i) =>
      item(word, i * 60, y),
    );
  }

  it('extracts exam session from a header row', () => {
    const rows = [
      makeRow('Second Semester 2024/2025', 20),
      makeRow('ICT/23/811 A', 100), // data row — stops scan
    ];
    const header = parseSheetHeader(rows);
    expect(header.examSession).toMatch(/Second Semester/i);
  });

  it('extracts course code from a header row', () => {
    const rows = [
      makeRow('IC3433 Internet Technology', 10),
      makeRow('ICT/23/811 A', 100),
    ];
    const header = parseSheetHeader(rows);
    expect(header.courseCode).toBe('IC3433');
  });

  it('extracts course name from the text after the code', () => {
    const rows = [
      [
        item('IC3433', 50, 10),
        item('Internet', 120, 10),
        item('Technology', 190, 10),
      ],
      makeRow('ICT/23/811 A', 100),
    ];
    const header = parseSheetHeader(rows);
    expect(header.courseName).toContain('Internet');
  });

  it('extracts date in "Month YYYY" format', () => {
    const rows = [
      makeRow('October 2024', 5),
      makeRow('ICT/23/811 A', 100),
    ];
    const header = parseSheetHeader(rows);
    expect(header.date).toBe('October 2024');
  });

  it('returns nulls when nothing is found', () => {
    const rows = [makeRow('ICT/23/811 A', 100)]; // starts with data immediately
    const header = parseSheetHeader(rows);
    expect(header.courseCode).toBeNull();
    expect(header.examSession).toBeNull();
  });

  it('stops scanning when it hits an index number row', () => {
    // The second row is a data row — parseSheetHeader must not look past it.
    const rows = [
      makeRow('Second Semester 2024', 20),
      makeRow('ICT/23/811 A', 100), // stop here
      makeRow('First Semester 2023', 200), // must NOT be picked up
    ];
    const header = parseSheetHeader(rows);
    // examSession from row 0 is found; row 2 is never reached
    expect(header.examSession).toMatch(/Second Semester/i);
  });

  it('handles space in course code like "IIC 2242"', () => {
    const rows = [
      [item('IIC', 50, 10), item('2242', 90, 10), item('Operating Systems', 130, 10)],
      makeRow('ICT/23/811 A', 100),
    ];
    const header = parseSheetHeader(rows);
    expect(header.courseCode).toBe('IIC2242');
  });
});

// ---------------------------------------------------------------------------
// 4. normaliseIndexNumber
// ---------------------------------------------------------------------------

describe('normaliseIndexNumber', () => {
  it('passes through a canonical index number unchanged', () => {
    expect(normaliseIndexNumber('ICT/23/811')).toBe('ICT/23/811');
  });

  it('handles missing slashes', () => {
    expect(normaliseIndexNumber('ICT23811')).toBe('ICT/23/811');
  });

  it('handles only one slash', () => {
    expect(normaliseIndexNumber('ICT23/811')).toBe('ICT/23/811');
  });

  it('handles spaces', () => {
    expect(normaliseIndexNumber('ICT 23 811')).toBe('ICT/23/811');
  });

  it('handles lower case', () => {
    expect(normaliseIndexNumber('ict/23/811')).toBe('ICT/23/811');
  });

  it('returns null for non-ICT tokens', () => {
    expect(normaliseIndexNumber('UOM/23/811')).toBeNull();
  });

  it('returns null for wrong digit count', () => {
    expect(normaliseIndexNumber('ICT/23/81')).toBeNull(); // 4 digits instead of 5
    expect(normaliseIndexNumber('ICT/234/811')).toBeNull(); // 6 digits
  });

  it('returns null for empty string', () => {
    expect(normaliseIndexNumber('')).toBeNull();
  });

  it('returns null for a grade token', () => {
    expect(normaliseIndexNumber('A-')).toBeNull();
  });

  it('normalises ITC department index numbers (e.g. for ITC1032, ITC2252)', () => {
    expect(normaliseIndexNumber('ITC/21/045')).toBe('ITC/21/045');
    expect(normaliseIndexNumber('ITC21045')).toBe('ITC/21/045');
    expect(normaliseIndexNumber('2021/ITC/045')).toBe('ITC/21/045');
    expect(normaliseIndexNumber('ITC/2021/045')).toBe('ITC/21/045');
    expect(normaliseIndexNumber('itc 21 045')).toBe('ITC/21/045');
    // Flexible 4-digit sequence numbers and dual academic years
    expect(normaliseIndexNumber('ITC/21/0045')).toBe('ITC/21/045');
    expect(normaliseIndexNumber('2021/ITC/0045')).toBe('ITC/21/045');
    expect(normaliseIndexNumber('2020/21/ITC/045')).toBe('ITC/20/045');
    expect(normaliseIndexNumber('TG/20/001')).toBe('TG/20/001');
  });
});

// ---------------------------------------------------------------------------
// 5. validateIndexNumber
// ---------------------------------------------------------------------------

describe('validateIndexNumber', () => {
  it('accepts ICT/23/811', () => {
    expect(validateIndexNumber('ICT/23/811')).toBe(true);
  });

  it('accepts ITC/21/045 (ITC prefix)', () => {
    expect(validateIndexNumber('ITC/21/045')).toBe(true);
  });

  it('accepts ICT/00/000 (edge case)', () => {
    expect(validateIndexNumber('ICT/00/000')).toBe(true);
  });

  it('accepts ICT/99/999 (edge case)', () => {
    expect(validateIndexNumber('ICT/99/999')).toBe(true);
  });

  it('rejects lower-case letters', () => {
    expect(validateIndexNumber('ict/23/811')).toBe(false);
  });

  it('rejects missing slashes', () => {
    expect(validateIndexNumber('ICT23811')).toBe(false);
  });

  it('rejects wrong digit counts', () => {
    expect(validateIndexNumber('ICT/234/811')).toBe(false);
    expect(validateIndexNumber('ICT/23/8119')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(validateIndexNumber('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. ensurePdfWorker
// ---------------------------------------------------------------------------

describe('ensurePdfWorker', () => {
  it('configures and returns a valid non-empty workerSrc string', async () => {
    const workerSrc = await ensurePdfWorker();
    expect(workerSrc).toBeTruthy();
    expect(typeof workerSrc).toBe('string');
    expect(workerSrc.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. extractAcademicYear (Academic Year from Module Code)
// ---------------------------------------------------------------------------

describe('extractAcademicYear', () => {
  it('extracts Year 1 from ITC 1052', () => {
    expect(extractAcademicYear('ITC 1052')).toBe(1);
    expect(extractAcademicYear('ITC1052')).toBe(1);
  });

  it('extracts Year 2 from IIC 2172', () => {
    expect(extractAcademicYear('IIC 2172')).toBe(2);
    expect(extractAcademicYear('IIC  2172')).toBe(2);
  });

  it('extracts Year 3 from IC 3341', () => {
    expect(extractAcademicYear('IC 3341')).toBe(3);
  });

  it('extracts Year 4 from IN 4462', () => {
    expect(extractAcademicYear('IN 4462')).toBe(4);
  });

  it('normalizes internal spaces and whitespace', () => {
    expect(extractAcademicYear('  ITC   2252  ')).toBe(2);
    expect(extractAcademicYear('IT1101')).toBe(1);
  });

  it('returns null for null, undefined, or empty codes', () => {
    expect(extractAcademicYear(null)).toBeNull();
    expect(extractAcademicYear(undefined)).toBeNull();
    expect(extractAcademicYear('')).toBeNull();
    expect(extractAcademicYear('   ')).toBeNull();
  });

  it('returns null for non-matching strings or invalid numbers', () => {
    expect(extractAcademicYear('INVALID_CODE')).toBeNull();
    expect(extractAcademicYear('12345')).toBeNull();
    expect(extractAcademicYear('ITC 0123')).toBeNull(); // 0 is invalid academic year
    expect(extractAcademicYear('ITC 9123')).toBeNull(); // 9 is beyond max year 5
  });

  it('strictly extracts only academic year and never determines semester', () => {
    // ITC 1052 has digit 1 (Year 1) - should return 1, not semester
    expect(extractAcademicYear('ITC 1052')).toBe(1);
    // IC 3442 has digit 3 (Year 3) - should return 3
    expect(extractAcademicYear('IC 3442')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 8. parseSemesterHeading (Semester and Year from PDF Examination Heading)
// ---------------------------------------------------------------------------

describe('parseSemesterHeading', () => {
  it('parses "First Semester Examination in 2025" -> Semester 1, 2025', () => {
    const res = parseSemesterHeading('First Semester Examination in 2025');
    expect(res.semesterNumber).toBe(1);
    expect(res.examYear).toBe('2025');
    expect(res.examSession).toBe('First Semester Examination in 2025');
  });

  it('parses "Second Semester Examination in 2025" -> Semester 2, 2025', () => {
    const res = parseSemesterHeading('Second Semester Examination in 2025');
    expect(res.semesterNumber).toBe(2);
    expect(res.examYear).toBe('2025');
    expect(res.examSession).toBe('Second Semester Examination in 2025');
  });

  it('handles variations with connectors: "in", "of", "for", hyphens, slashes', () => {
    const ofRes = parseSemesterHeading('First Semester Examination of 2024');
    expect(ofRes.semesterNumber).toBe(1);
    expect(ofRes.examYear).toBe('2024');

    const hyphenRes = parseSemesterHeading('Second Semester Examination - 2024/2025');
    expect(hyphenRes.semesterNumber).toBe(2);
    expect(hyphenRes.examYear).toBe('2024/2025');

    const colonRes = parseSemesterHeading('First Semester Examination: 2023');
    expect(colonRes.semesterNumber).toBe(1);
    expect(colonRes.examYear).toBe('2023');
  });

  it('handles "Semester X Examination" order', () => {
    const s1 = parseSemesterHeading('Semester 1 Examination in 2025');
    expect(s1.semesterNumber).toBe(1);
    expect(s1.examYear).toBe('2025');

    const s2 = parseSemesterHeading('Semester II Examination 2024');
    expect(s2.semesterNumber).toBe(2);
    expect(s2.examYear).toBe('2024');
  });

  it('handles "Examination in YYYY ... Semester" order', () => {
    const res = parseSemesterHeading('Examination in 2025 - First Semester');
    expect(res.semesterNumber).toBe(1);
    expect(res.examYear).toBe('2025');
  });

  it('handles multiline/spaced OCR artifacts', () => {
    const res = parseSemesterHeading('Second  Semester   Examination   in   2024/2025');
    expect(res.semesterNumber).toBe(2);
    expect(res.examYear).toBe('2024/2025');
  });

  it('returns nulls when heading does not contain examination semester', () => {
    const res = parseSemesterHeading('FACULTY OF TECHNOLOGY - UNIVERSITY OF COLOMBO');
    expect(res.semesterNumber).toBeNull();
    expect(res.examYear).toBeNull();
    expect(res.examSession).toBeNull();
  });

  it('does not invent semester when given only course code', () => {
    const res = parseSemesterHeading('ITC 2252 Introduction to Machine Learning');
    expect(res.semesterNumber).toBeNull();
    expect(res.examYear).toBeNull();
    expect(res.examSession).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. SheetHeader Integration (academicYear, semesterNumber, warnings)
// ---------------------------------------------------------------------------

describe('parseSheetHeader with Academic Year and Semester extraction', () => {
  function makeRow(text: string, y: number): PdfTextItem[] {
    return text.split(/\s+/).map((word, i) =>
      item(word, i * 60, y),
    );
  }

  it('populates academicYear, semesterNumber, examYear, and sets no warnings when all present', () => {
    const rows = [
      makeRow('UNIVERSITY OF SRI JAYEWARDENEPURA', 10),
      makeRow('First Semester Examination in 2025', 20),
      makeRow('ITC 1052 Mathematics for Computing', 30),
      makeRow('October 2024', 40),
      makeRow('ICT/23/811 A', 100),
    ];
    const header = parseSheetHeader(rows);
    expect(header.courseCode).toBe('ITC1052');
    expect(header.courseName).toBe('Mathematics for Computing');
    expect(header.academicYear).toBe(1);
    expect(header.semesterNumber).toBe(1);
    expect(header.examYear).toBe('2025');
    expect(header.examSession).toBe('First Semester Examination in 2025');
    expect(header.semesterWarning).toBeNull();
    expect(header.academicYearWarning).toBeNull();
  });

  it('sets semesterWarning when examination heading is missing', () => {
    const rows = [
      makeRow('FACULTY OF TECHNOLOGY', 10),
      makeRow('IIC 2172 Object Oriented Programming', 20),
      makeRow('ICT/23/811 A', 100),
    ];
    const header = parseSheetHeader(rows);
    expect(header.courseCode).toBe('IIC2172');
    expect(header.academicYear).toBe(2);
    expect(header.semesterNumber).toBeNull();
    expect(header.semesterWarning).toBeDefined();
    expect(header.semesterWarning).toContain('Examination semester heading could not be identified');
  });
});
