/**
 * extract/reconcile.test.ts
 *
 * Vitest unit tests for M3 — reconciliation pipeline.
 *
 * Tests cover:
 *  1. findRowColumns       — identifies index and grade columns.
 *  2. extractTextLayerRows — handles single-column and two-column layouts.
 *  3. extractOcrGrade      — extracts grade from an OCR word row.
 *  4. reconcileRow         — the core agree/disagree/OCR-only logic.
 *  5. reconcilePage        — page-level: duplicate detection, invalid index count.
 *  6. buildTextRowsFromOcr — OCR-only path (no text layer).
 *  7. matchOcrToTextRows   — spatial y-position matching.
 *
 * All tests are pure; no real PDF or Tesseract is invoked.
 */

import { describe, it, expect } from 'vitest';
import {
  findRowColumns,
  extractTextLayerRows,
  extractOcrGrade,
  reconcileRow,
  reconcilePage,
  buildTextRowsFromOcr,
  matchOcrToTextRows,
  reconstructRowItems,
  isSummaryOrFooterRow,
  isOcrMutationOfExisting,
  type TextLayerRow,
  type ReconcileInput,
} from './reconcile';
import { groupItemsIntoRows, type PdfTextItem } from './pdfText';
import type { OcrWord } from './ocr';
import type { ResultRow } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pdfItem(str: string, x: number, y: number): PdfTextItem {
  return { str, x, y, width: str.length * 6, height: 12, fontSize: 10 };
}

function ocrWord(text: string, x0: number, y0: number, x1?: number, y1?: number): OcrWord {
  return {
    text,
    confidence: 95,
    bbox: { x0, y0, x1: x1 ?? x0 + text.length * 8, y1: y1 ?? y0 + 14 },
  };
}

function textRow(
  indexNumber: string,
  grade: string | null,
  y = 100,
): TextLayerRow {
  return { indexNumber, rawIndex: indexNumber, textGradeOrStatus: grade, y };
}

// ---------------------------------------------------------------------------
// 1. findRowColumns
// ---------------------------------------------------------------------------

describe('findRowColumns', () => {
  it('finds index and grade in a simple two-item row', () => {
    const row = [pdfItem('ICT/23/811', 50, 100), pdfItem('A-', 200, 100)];
    const result = findRowColumns(row);
    expect(result).not.toBeNull();
    expect(result!.indexItem.str).toBe('ICT/23/811');
    expect(result!.gradeItem?.str).toBe('A-');
  });

  it('returns null when there is no index number in the row', () => {
    const row = [pdfItem('Course Code', 50, 10), pdfItem('IC3433', 200, 10)];
    expect(findRowColumns(row)).toBeNull();
  });

  it('handles a row with only an index number (no grade)', () => {
    const row = [pdfItem('ICT/23/811', 50, 100)];
    const result = findRowColumns(row);
    expect(result).not.toBeNull();
    expect(result!.gradeItem).toBeNull();
  });

  it('picks the rightmost item as the grade column', () => {
    const row = [
      pdfItem('ICT/23/811', 50, 100),
      pdfItem('Some', 150, 100),
      pdfItem('B+', 300, 100), // rightmost
    ];
    const result = findRowColumns(row);
    expect(result!.gradeItem?.str).toBe('B+');
  });
});

// ---------------------------------------------------------------------------
// 2. extractTextLayerRows
// ---------------------------------------------------------------------------

describe('extractTextLayerRows', () => {
  it('extracts a single-column row', () => {
    const items = [pdfItem('ICT/23/811', 50, 100), pdfItem('A-', 200, 100)];
    const rows = groupItemsIntoRows(items);
    const result = extractTextLayerRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].indexNumber).toBe('ICT/23/811');
    expect(result[0].textGradeOrStatus).toBe('A-');
  });

  it('extracts multiple single-column rows', () => {
    const items = [
      pdfItem('ICT/23/811', 50, 100), pdfItem('A-', 200, 100),
      pdfItem('ICT/23/825', 50, 114), pdfItem('B-', 200, 114),
      pdfItem('ICT/23/869', 50, 128), pdfItem('B-', 200, 128),
    ];
    const rows = groupItemsIntoRows(items);
    const result = extractTextLayerRows(rows);
    expect(result).toHaveLength(3);
    expect(result[0].indexNumber).toBe('ICT/23/811');
    expect(result[1].indexNumber).toBe('ICT/23/825');
    expect(result[2].indexNumber).toBe('ICT/23/869');
  });

  it('skips rows that contain no index number (e.g. header rows)', () => {
    const items = [
      pdfItem('Course', 50, 10), pdfItem('IC3433', 200, 10), // header
      pdfItem('ICT/23/811', 50, 100), pdfItem('A', 200, 100), // data
    ];
    const rows = groupItemsIntoRows(items);
    const result = extractTextLayerRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].indexNumber).toBe('ICT/23/811');
  });

  it('handles a two-column layout (two index numbers on the same y)', () => {
    const items = [
      pdfItem('ICT/23/801', 50, 100),  pdfItem('A+', 150, 100),
      pdfItem('ICT/23/802', 300, 100), pdfItem('B',  400, 100),
    ];
    const rows = groupItemsIntoRows(items);
    const result = extractTextLayerRows(rows);
    expect(result).toHaveLength(2);

    const indices = result.map((r) => r.indexNumber).sort();
    expect(indices).toContain('ICT/23/801');
    expect(indices).toContain('ICT/23/802');
  });

  it('handles two-column layout with serial numbers and ITC index numbers (e.g. ITC1032)', () => {
    const items = [
      pdfItem('1', 20, 100),
      pdfItem('ITC/21/001', 50, 100),
      pdfItem('A', 150, 100),
      pdfItem('26', 250, 100),
      pdfItem('ITC/21/026', 300, 100),
      pdfItem('B+', 400, 100),
    ];
    const rows = groupItemsIntoRows(items);
    const result = extractTextLayerRows(rows);
    expect(result).toHaveLength(2);

    expect(result[0].indexNumber).toBe('ITC/21/001');
    expect(result[0].textGradeOrStatus).toBe('A');

    expect(result[1].indexNumber).toBe('ITC/21/026');
    expect(result[1].textGradeOrStatus).toBe('B+');
  });

  it('reconstructs index numbers split across multiple text stream fragments', () => {
    // "ITC/", "21/", "042" split into 3 items
    const items = [
      pdfItem('ITC/', 50, 100),
      pdfItem('21/', 80, 100),
      pdfItem('042', 105, 100),
      pdfItem('A-', 200, 100),
    ];
    const rows = groupItemsIntoRows(items);
    const result = extractTextLayerRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].indexNumber).toBe('ITC/21/042');
    expect(result[0].textGradeOrStatus).toBe('A-');
  });

  it('extracts all 50 students across a 2-column page', () => {
    const pageItems: ReturnType<typeof pdfItem>[] = [];
    for (let r = 0; r < 25; r++) {
      const y = 100 + r * 16;
      const idx1 = `ITC/21/${String(r + 1).padStart(3, '0')}`;
      const idx2 = `ITC/21/${String(r + 26).padStart(3, '0')}`;
      pageItems.push(
        pdfItem(String(r + 1), 20, y),
        pdfItem(idx1, 50, y),
        pdfItem('A', 150, y),
        pdfItem(String(r + 26), 250, y),
        pdfItem(idx2, 300, y),
        pdfItem('B', 400, y),
      );
    }
    const rows = groupItemsIntoRows(pageItems);
    const result = extractTextLayerRows(rows);
    expect(result).toHaveLength(50);
  });

  it('normalises index numbers during extraction', () => {
    // OCR may produce "ICT23811" without slashes
    const items = [pdfItem('ICT23811', 50, 100), pdfItem('A', 200, 100)];
    const rows = groupItemsIntoRows(items);
    const result = extractTextLayerRows(rows);
    expect(result).toHaveLength(1);
    expect(result[0].indexNumber).toBe('ICT/23/811');
  });
});

// ---------------------------------------------------------------------------
// 3. extractOcrGrade
// ---------------------------------------------------------------------------

describe('extractOcrGrade', () => {
  it('extracts the grade from an OCR row with an index number', () => {
    const row = [ocrWord('ICT/23/811', 50, 100), ocrWord('A-', 200, 100)];
    expect(extractOcrGrade(row)).toBe('A-');
  });

  it('returns null for an empty OCR row', () => {
    expect(extractOcrGrade([])).toBeNull();
  });

  it('handles a compound status in the OCR row', () => {
    const row = [
      ocrWord('ICT/23/811', 50, 100),
      ocrWord('E(CA)', 200, 100),
      ocrWord('&', 260, 100),
      ocrWord('AB(ESA)', 290, 100),
    ];
    const result = extractOcrGrade(row);
    expect(result).toBe('E(CA) & AB(ESA)');
  });

  it('falls back to rightmost word when no index number is in the row', () => {
    const row = [ocrWord('Something', 50, 100), ocrWord('B+', 200, 100)];
    expect(extractOcrGrade(row)).toBe('B+');
  });
});

// ---------------------------------------------------------------------------
// 4. reconcileRow — core agree/disagree/OCR-only logic (spec §5)
// ---------------------------------------------------------------------------

describe('reconcileRow', () => {
  // ── Agree: text and OCR match ──────────────────────────────────────────────
  it('accepts agreed values with no flag', () => {
    const input: ReconcileInput = {
      textRow: textRow('ICT/23/811', 'A', 100),
      ocrCellText: 'A',
      noTextLayer: false,
    };
    const row = reconcileRow(input);
    expect(row.workingValue).toBe('A');
    expect(row.flags).toHaveLength(0);
    expect(row.textReading).toBe('A');
    expect(row.ocrReading).toBe('A');
  });

  it('is case-insensitive when comparing text and OCR', () => {
    const input: ReconcileInput = {
      textRow: textRow('ICT/23/811', 'b+', 100),
      ocrCellText: 'B+',
      noTextLayer: false,
    };
    const row = reconcileRow(input);
    // They agree (case-normalised), so no check-this flag
    expect(row.flags).not.toContain('check-this');
  });

  // ── Disagree: OCR wins, 'check-this' flag (spec §5) ──────────────────────
  it('uses OCR reading and flags "check-this" when text and OCR disagree', () => {
    // This is the spec §11 scenario: text layer reads "A" but correct is "A-"
    const input: ReconcileInput = {
      textRow: textRow('ICT/23/811', 'A', 100),  // text layer drops minus sign
      ocrCellText: 'A-',                           // OCR reads correctly
      noTextLayer: false,
    };
    const row = reconcileRow(input);
    expect(row.workingValue).toBe('A-');
    expect(row.flags).toContain('check-this');
    expect(row.textReading).toBe('A');
    expect(row.ocrReading).toBe('A-');
    expect(row.grade).toBe('A-');
  });

  it('flags "check-this" for the B- vs B disagreement (spec §11)', () => {
    const input: ReconcileInput = {
      textRow: textRow('ICT/23/825', 'B', 100),
      ocrCellText: 'B-',
      noTextLayer: false,
    };
    const row = reconcileRow(input);
    expect(row.workingValue).toBe('B-');
    expect(row.flags).toContain('check-this');
  });

  it('flags "check-this" for the second B- case (spec §11)', () => {
    const input: ReconcileInput = {
      textRow: textRow('ICT/23/869', 'B', 100),
      ocrCellText: 'B-',
      noTextLayer: false,
    };
    const row = reconcileRow(input);
    expect(row.workingValue).toBe('B-');
    expect(row.flags).toContain('check-this');
    expect(row.grade).toBe('B-');
  });

  // ── Text only: no OCR available ───────────────────────────────────────────
  it('uses text reading with no flag when OCR is unavailable', () => {
    const input: ReconcileInput = {
      textRow: textRow('ICT/23/811', 'B+', 100),
      ocrCellText: null,
      noTextLayer: false,
    };
    const row = reconcileRow(input);
    expect(row.workingValue).toBe('B+');
    expect(row.flags).toHaveLength(0);
  });

  // ── OCR only: no text layer (spec §5 "OCR" indicator) ─────────────────────
  it('uses OCR value and flags "ocr" when there is no text layer', () => {
    const input: ReconcileInput = {
      textRow: textRow('ICT/23/811', null, 100),
      ocrCellText: 'C+',
      noTextLayer: true,
    };
    const row = reconcileRow(input);
    expect(row.workingValue).toBe('C+');
    expect(row.flags).toContain('ocr');
    expect(row.flags).not.toContain('check-this');
    expect(row.textReading).toBeNull();
  });

  it('flags "ocr" when text layer is absent and OCR provides the value', () => {
    const input: ReconcileInput = {
      textRow: textRow('ICT/23/801', null, 100),
      ocrCellText: 'D',
      noTextLayer: false, // text layer exists but this cell was null
    };
    const row = reconcileRow(input);
    // textVal is null → OCR is sole source → 'ocr' flag
    expect(row.flags).toContain('ocr');
    expect(row.workingValue).toBe('D');
  });

  // ── Both null ─────────────────────────────────────────────────────────────
  it('produces empty workingValue when both readings are null', () => {
    const input: ReconcileInput = {
      textRow: textRow('ICT/23/811', null, 100),
      ocrCellText: null,
      noTextLayer: true,
    };
    const row = reconcileRow(input);
    expect(row.workingValue).toBe('');
  });

  // ── Compound status ───────────────────────────────────────────────────────
  it('correctly parses a compound status from the working value', () => {
    const input: ReconcileInput = {
      textRow: textRow('ICT/23/811', 'E(CA) & AB(ESA)', 100),
      ocrCellText: 'E(CA) & AB(ESA)',
      noTextLayer: false,
    };
    const row = reconcileRow(input);
    expect(row.status).toBe('E(CA) & AB(ESA)');
    expect(row.grade).toBeNull();
    expect(row.flags).toHaveLength(0);
  });

  // ── Index number passthrough ──────────────────────────────────────────────
  it('preserves the normalised index number in the result row', () => {
    const input: ReconcileInput = {
      textRow: textRow('ICT/23/908', 'A', 100),
      ocrCellText: 'A',
      noTextLayer: false,
    };
    const row = reconcileRow(input);
    expect(row.indexNumber).toBe('ICT/23/908');
  });
});

// ---------------------------------------------------------------------------
// 5. reconcilePage — duplicate and invalid index detection
// ---------------------------------------------------------------------------

describe('reconcilePage', () => {
  it('reconciles a simple page with no duplicates', () => {
    const textRows: TextLayerRow[] = [
      textRow('ICT/23/811', 'A-', 100),
      textRow('ICT/23/825', 'B-', 114),
    ];
    const result = reconcilePage(textRows, [], false);
    expect(result.rows).toHaveLength(2);
    expect(result.duplicateIndexNumbers).toHaveLength(0);
    expect(result.invalidIndexCount).toBe(0);
  });

  it('detects duplicate index numbers', () => {
    const textRows: TextLayerRow[] = [
      textRow('ICT/23/811', 'A', 100),
      textRow('ICT/23/811', 'B', 114), // duplicate
    ];
    const result = reconcilePage(textRows, [], false);
    expect(result.duplicateIndexNumbers).toContain('ICT/23/811');
  });

  it('counts invalid index numbers', () => {
    const textRows: TextLayerRow[] = [
      { indexNumber: null, rawIndex: 'BADIDX', textGradeOrStatus: 'A', y: 100 },
      textRow('ICT/23/811', 'B', 114),
    ];
    const result = reconcilePage(textRows, [], false);
    expect(result.invalidIndexCount).toBe(1);
    expect(result.rows).toHaveLength(2);
  });

  it('applies "check-this" flag when OCR and text disagree (integration)', () => {
    const textRows: TextLayerRow[] = [
      textRow('ICT/23/811', 'A', 100), // text drops the minus sign
    ];
    // OCR words that match the row's y position
    const ocrWords: OcrWord[] = [
      ocrWord('ICT/23/811', 100, 200, 260, 214),  // y0=200, scaled down: 200/2=100
      ocrWord('A-',          270, 200, 310, 214),
    ];
    const result = reconcilePage(textRows, ocrWords, false, 2.0);
    // The OCR row at pixel-y 200 maps to pdf-y 100 (200/2=100), matching textRow.y=100
    const row = result.rows[0];
    expect(row.workingValue).toBe('A-');
    expect(row.flags).toContain('check-this');
  });

  it('returns 0 duplicates for an empty page', () => {
    const result = reconcilePage([], [], false);
    expect(result.rows).toHaveLength(0);
    expect(result.duplicateIndexNumbers).toHaveLength(0);
    expect(result.invalidIndexCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. buildTextRowsFromOcr — OCR-only path
// ---------------------------------------------------------------------------

describe('buildTextRowsFromOcr', () => {
  it('builds text rows from OCR words (no text layer)', () => {
    const words: OcrWord[] = [
      ocrWord('ICT/23/811', 50, 200, 200, 214),
      ocrWord('A-',          210, 200, 250, 214),
      ocrWord('ICT/23/825', 50, 220, 200, 234),
      ocrWord('B-',          210, 220, 250, 234),
    ];
    const rows = buildTextRowsFromOcr(words, 2.0);
    expect(rows).toHaveLength(2);

    const indices = rows.map((r) => r.indexNumber).sort();
    expect(indices).toContain('ICT/23/811');
    expect(indices).toContain('ICT/23/825');
  });

  it('skips OCR rows that have no identifiable index number', () => {
    const words: OcrWord[] = [
      ocrWord('Course', 50, 20, 150, 34),   // header word — no index
      ocrWord('IC3433', 160, 20, 240, 34),
      ocrWord('ICT/23/811', 50, 200, 200, 214),
      ocrWord('A', 210, 200, 250, 214),
    ];
    const rows = buildTextRowsFromOcr(words, 2.0);
    expect(rows).toHaveLength(1);
    expect(rows[0].indexNumber).toBe('ICT/23/811');
  });

  it('returns empty array when there are no OCR words', () => {
    expect(buildTextRowsFromOcr([], 2.0)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. matchOcrToTextRows — spatial matching
// ---------------------------------------------------------------------------

describe('matchOcrToTextRows', () => {
  it('matches OCR rows to text rows by y proximity', () => {
    const textRows: TextLayerRow[] = [
      textRow('ICT/23/811', 'A', 100), // pdf y = 100
    ];
    const ocrWords: OcrWord[] = [
      // pixel-y = 200 → pdf-y = 200/2 = 100 (exact match)
      ocrWord('ICT/23/811', 100, 200, 260, 214),
      ocrWord('A-',          270, 200, 310, 214),
    ];
    const matches = matchOcrToTextRows(textRows, ocrWords, 2.0, 8);
    expect(matches.has(0)).toBe(true);
    expect(matches.get(0)!.length).toBeGreaterThan(0);
  });

  it('returns an empty map when there are no OCR words', () => {
    const textRows: TextLayerRow[] = [textRow('ICT/23/811', 'A', 100)];
    const matches = matchOcrToTextRows(textRows, [], 2.0);
    expect(matches.size).toBe(0);
  });

  it('does not match rows that are far apart in y', () => {
    const textRows: TextLayerRow[] = [
      textRow('ICT/23/811', 'A', 100),
    ];
    // OCR word at pixel-y 600 → pdf-y 300, which is 200 pts away from textRow y=100
    const ocrWords: OcrWord[] = [
      ocrWord('ICT/23/999', 100, 600, 260, 614),
    ];
    const matches = matchOcrToTextRows(textRows, ocrWords, 2.0, 8);
    expect(matches.has(0)).toBe(false);
  });

  it('reconciles image-only page using OCR words alone when textRows is empty', () => {
    const ocrWords: OcrWord[] = [
      ocrWord('ITC/21/001', 50, 100, 150, 120),
      ocrWord('A', 170, 100, 200, 120),
      ocrWord('ITC/21/002', 50, 140, 150, 160),
      ocrWord('B+', 170, 140, 200, 160),
    ];
    const res = reconcilePage([], ocrWords, true, 2.0);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].indexNumber).toBe('ITC/21/001');
    expect(res.rows[0].workingValue).toBe('A');
    expect(res.rows[0].flags).toContain('ocr');
    expect(res.rows[1].indexNumber).toBe('ITC/21/002');
    expect(res.rows[1].workingValue).toBe('B+');
    expect(res.rows[1].flags).toContain('ocr');
  });

  it('recovers rows dropped by text layer and flags them as ocr', () => {
    const textRows: TextLayerRow[] = [
      textRow('ITC/21/001', 'A', 50),
    ];
    const ocrWords: OcrWord[] = [
      ocrWord('ITC/21/001', 50, 100, 150, 120),
      ocrWord('A', 170, 100, 200, 120),
      // Second student row missing from text layer:
      ocrWord('ITC/21/002', 50, 160, 150, 180),
      ocrWord('B', 170, 160, 200, 180),
    ];
    const res = reconcilePage(textRows, ocrWords, false, 2.0);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0].indexNumber).toBe('ITC/21/001');
    expect(res.rows[0].flags).toEqual([]);
    expect(res.rows[1].indexNumber).toBe('ITC/21/002');
    expect(res.rows[1].flags).toContain('ocr');
  });

  // -------------------------------------------------------------------------
  // 8. Regression tests for mixed text/image sheets (ITC 2252 Machine Learning)
  // -------------------------------------------------------------------------
  it('correctly associates OCR grades to students in multi-column mixed text/image sheet', () => {
    // In ITC 2252: text layer has student numbers, but grades cannot be selected (textGradeOrStatus is null)
    // Physical row at y = 100 has 2 columns:
    // Column 1: ITC/21/001 at x = 50
    // Column 2: ITC/21/026 at x = 300
    const textRows: TextLayerRow[] = [
      {
        indexNumber: 'ITC/21/001',
        rawIndex: 'ITC/21/001',
        textGradeOrStatus: null,
        x: 50,
        y: 100,
      },
      {
        indexNumber: 'ITC/21/026',
        rawIndex: 'ITC/21/026',
        textGradeOrStatus: null,
        x: 300,
        y: 100,
      },
    ];

    // OCR recognizes only the image-based grades at pixel y = 200 (scale 2.0 -> pdf y = 100):
    // Grade for column 1 is at pixel x in [180, 220]
    // Grade for column 2 is at pixel x in [650, 690] (pdf x ~ 325-345)
    const ocrWords: OcrWord[] = [
      ocrWord('A', 180, 195, 220, 215),
      ocrWord('B+', 650, 195, 690, 215),
    ];

    const result = reconcilePage(textRows, ocrWords, false, 2.0);

    expect(result.rows).toHaveLength(2);
    // Student 1 must receive Student 1's grade 'A', not Student 2's grade
    expect(result.rows[0].indexNumber).toBe('ITC/21/001');
    expect(result.rows[0].workingValue).toBe('A');
    expect(result.rows[0].grade).toBe('A');
    expect(result.rows[0].flags).toContain('ocr');

    // Student 2 must receive Student 2's grade 'B+'
    expect(result.rows[1].indexNumber).toBe('ITC/21/026');
    expect(result.rows[1].workingValue).toBe('B+');
    expect(result.rows[1].grade).toBe('B+');
    expect(result.rows[1].flags).toContain('ocr');
  });

  it('flags unrecoverable missing grades with check-this for manual review without inventing grades', () => {
    const textRows: TextLayerRow[] = [
      {
        indexNumber: 'ITC/21/005',
        rawIndex: 'ITC/21/005',
        textGradeOrStatus: null, // missing in text layer
        x: 50,
        y: 120,
      },
    ];

    // OCR did not recognize any grade in this area
    const ocrWords: OcrWord[] = [];

    const result = reconcilePage(textRows, ocrWords, false, 2.0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].indexNumber).toBe('ITC/21/005');
    expect(result.rows[0].grade).toBeNull();
    expect(result.rows[0].status).toBeNull();
    expect(result.rows[0].workingValue).toBe('');
    expect(result.rows[0].flags).toContain('check-this');
  });

  it('reconstructs heavily fragmented index tokens across > 5 items', () => {
    // "2021", "/", "I", "T", "C", "/", "0", "4", "5" (9 items)
    const fragmentedItems: PdfTextItem[] = [
      pdfItem('2021', 50, 100),
      pdfItem('/', 70, 100),
      pdfItem('I', 75, 100),
      pdfItem('T', 80, 100),
      pdfItem('C', 85, 100),
      pdfItem('/', 90, 100),
      pdfItem('0', 95, 100),
      pdfItem('4', 100, 100),
      pdfItem('5', 105, 100),
    ];

    const reconstructed = reconstructRowItems(fragmentedItems);
    expect(reconstructed).toHaveLength(1);
    expect(reconstructed[0].str).toBe('ITC/21/045');
  });

  it('normalises 4-digit sequence numbers and dual academic years', () => {
    const rowWith4DigitSeq: PdfTextItem[] = [
      pdfItem('ITC/21/0045', 50, 100),
      pdfItem('A', 150, 100),
    ];
    const extracted = extractTextLayerRows([rowWith4DigitSeq]);
    expect(extracted).toHaveLength(1);
    expect(extracted[0].indexNumber).toBe('ITC/21/045');
    expect(extracted[0].textGradeOrStatus).toBe('A');

    const rowWithDualYear: PdfTextItem[] = [
      pdfItem('2020/21/ITC/012', 50, 100),
      pdfItem('B', 150, 100),
    ];
    const extractedDual = extractTextLayerRows([rowWithDualYear]);
    expect(extractedDual).toHaveLength(1);
    expect(extractedDual[0].indexNumber).toBe('ITC/20/012');
    expect(extractedDual[0].textGradeOrStatus).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// 10. Multi-Page Two-Column & 153-Student Grade Sheet Regression
// ---------------------------------------------------------------------------

describe('Two-Column Multi-Page 153-Student Grade Sheet Extraction (IIC 1123 Regression)', () => {
  it('correctly pairs grades in a two-column layout when stream reading order is mixed', () => {
    // In stream order: Col 2 index and grade appear before Col 1 index and grade, or interleaved
    const mixedStreamItems: PdfTextItem[] = [
      pdfItem('ICT/23/826', 324, 261), // Col 2 Index
      pdfItem('ICT/23/801', 54.6, 261), // Col 1 Index
      pdfItem('B+', 452, 261), // Col 2 Grade
      pdfItem('B', 185.3, 261), // Col 1 Grade
    ];
    const rows = groupItemsIntoRows(mixedStreamItems);
    const extracted = extractTextLayerRows(rows);

    expect(extracted).toHaveLength(2);
    const r1 = extracted.find((r) => r.indexNumber === 'ICT/23/801');
    const r2 = extracted.find((r) => r.indexNumber === 'ICT/23/826');

    expect(r1).toBeDefined();
    expect(r1?.textGradeOrStatus).toBe('B');

    expect(r2).toBeDefined();
    expect(r2?.textGradeOrStatus).toBe('B+');
  });

  it('extracts exactly 153 unique student records from a 4-page representative two-column grade sheet', () => {
    // Builds a representative 4-page grade sheet modeled on IIC 1123 Database Systems
    const pagesItems: PdfTextItem[][] = [];

    // Pages 1 to 3: 50 students per page (25 rows x 2 columns)
    let seq = 801;
    for (let p = 1; p <= 3; p++) {
      const pageItems: PdfTextItem[] = [
        pdfItem('UNIVERSITY OF SRI JAYEWARDENEPURA', 117, 68),
        pdfItem('Second Semester Examination in 2025', 212, 148),
        pdfItem('IIC 1123 Database Systems', 127, 190),
        pdfItem('Index No', 71.2, 240),
        pdfItem('Grade', 176.6, 240),
        pdfItem('Index No', 340.8, 240),
        pdfItem('Grade', 446.8, 240),
      ];

      for (let r = 0; r < 25; r++) {
        const y = 261 + r * 19.9;
        const col1Index = `ICT/23/${seq++}`;
        const col2Index = `ICT/23/${seq++}`;
        // Mixed stream order for each row
        pageItems.push(
          pdfItem(col2Index, 324.0, y),
          pdfItem(col1Index, 54.6, y),
          pdfItem('B+', 452.0, y),
          pdfItem('A-', 183.8, y),
        );
      }
      pagesItems.push(pageItems);
    }

    // Page 4: 3 students in Column 1, 0 students in Column 2,
    // plus grade distribution summary table, chart labels, and footer
    const page4Items: PdfTextItem[] = [
      pdfItem('UNIVERSITY OF SRI JAYEWARDENEPURA', 117, 68),
      pdfItem('Second Semester Examination in 2025', 212, 148),
      pdfItem('IIC 1123 Database Systems', 127, 190),
      pdfItem('Index No', 71.2, 240),
      pdfItem('Grade', 176.6, 240),
      pdfItem('Index No', 340.8, 240),
      pdfItem('Grade', 446.8, 240),
      // 3 real student rows in Col 1 (ICT/23/951, ICT/23/952, ICT/23/953)
      pdfItem('ICT/23/951', 54.6, 261.0),
      pdfItem('B+', 182.6, 261.0),
      pdfItem('ICT/23/952', 54.6, 280.9),
      pdfItem('B', 185.3, 280.9),
      pdfItem('ICT/23/953', 54.6, 300.8),
      pdfItem('A-', 183.8, 300.8),
      // Summary table rows below student rows
      pdfItem('A', 70.4, 419.6),
      pdfItem('9', 114.3, 419.6),
      pdfItem('5.9%', 134.5, 419.6),
      pdfItem('A-', 70.4, 429.9),
      pdfItem('33', 109.4, 429.9),
      pdfItem('21.6%', 129.6, 429.9),
      pdfItem('B+', 70.4, 440.3),
      pdfItem('42', 109.4, 440.3),
      pdfItem('27.5%', 129.6, 440.3),
      pdfItem('B', 70.4, 450.6),
      pdfItem('32', 109.4, 450.6),
      pdfItem('20.9%', 129.6, 450.6),
      pdfItem('Total:', 70.4, 504.3),
      pdfItem('153', 104.5, 504.3),
      pdfItem('100.0%', 124.7, 504.3),
      // Chart labels and tick counts (28, 24, 20, 16, 12, 8, 4, 0)
      pdfItem('28', 170.2, 364.8),
      pdfItem('24', 170.2, 396.0),
      pdfItem('20', 170.2, 429.9),
      pdfItem('16', 170.2, 461.0),
      pdfItem('Others', 70.4, 492.2),
      pdfItem('A', 202.0, 591.2),
      pdfItem('A-', 244.8, 591.2),
      pdfItem('B+', 288.1, 591.2),
      pdfItem('B', 334.7, 591.2),
      pdfItem('Others', 502.2, 591.2),
      // Footers
      pdfItem('Entered by', 47.9, 618.4),
      pdfItem(': Ms. M.H Paul', 96.2, 618.4),
      pdfItem('Entered Date : 4/7/2025 11:12:11 AM', 47.9, 630.0),
    ];
    pagesItems.push(page4Items);

    const allReconciled: ResultRow[] = [];
    const seenIndices = new Map<string, ResultRow>();

    for (let p = 0; p < pagesItems.length; p++) {
      const rows = groupItemsIntoRows(pagesItems[p]);
      const textRows = extractTextLayerRows(rows);

      // Reconcile page (no OCR words needed since text layer is complete)
      const reconciled = reconcilePage(textRows, [], false);

      for (const r of reconciled.rows) {
        if (!r.indexNumber) continue;
        const norm = r.indexNumber.toUpperCase().replace(/\s+/g, '');
        if (!seenIndices.has(norm)) {
          seenIndices.set(norm, r);
          allReconciled.push(r);
        }
      }
    }

    // Must extract exactly 153 students (50 + 50 + 50 + 3)
    expect(allReconciled).toHaveLength(153);
    expect(seenIndices.size).toBe(153);

    // Assert first and last students
    expect(allReconciled[0].indexNumber).toBe('ICT/23/801');
    expect(allReconciled[0].grade).toBe('A-');

    const last = allReconciled[allReconciled.length - 1];
    expect(last.indexNumber).toBe('ICT/23/953');
    expect(last.grade).toBe('A-');

    // Chart labels (28, 24, Others, etc.) must NEVER appear as students
    const anyPhantom = allReconciled.some(
      (r) => r.indexNumber === '28' || r.indexNumber.includes('Others') || r.indexNumber.startsWith('A/') || r.indexNumber.startsWith('E/'),
    );
    expect(anyPhantom).toBe(false);
  });

  it('flags student rows with "check-this" when grade is missing or unverified', () => {
    const rowWithoutGrade: PdfTextItem[] = [
      pdfItem('ICT/23/855', 54.6, 261.0),
      // no grade item to the right
    ];
    const rows = groupItemsIntoRows(rowWithoutGrade);
    const textRows = extractTextLayerRows(rows);
    expect(textRows).toHaveLength(1);
    expect(textRows[0].textGradeOrStatus).toBeNull();

    const reconciled = reconcilePage(textRows, [], false);
    expect(reconciled.rows).toHaveLength(1);
    expect(reconciled.rows[0].flags).toContain('check-this');
    expect(reconciled.rows[0].workingValue).toBe('');
    expect(reconciled.rows[0].grade).toBeNull();
  });

  it('detects duplicate student records with conflicting grades and flags them', () => {
    const row1: PdfTextItem[] = [
      pdfItem('ICT/23/801', 54.6, 261.0),
      pdfItem('A', 185.0, 261.0),
    ];
    const row2: PdfTextItem[] = [
      pdfItem('ICT/23/801', 54.6, 280.0),
      pdfItem('C', 185.0, 280.0),
    ];
    const rows = groupItemsIntoRows([...row1, ...row2]);
    const textRows = extractTextLayerRows(rows);
    expect(textRows).toHaveLength(2);

    const reconciled = reconcilePage(textRows, [], false);
    expect(reconciled.duplicateIndexNumbers).toContain('ICT/23/801');
    // Both conflicting rows must be marked check-this
    expect(reconciled.rows[0].flags).toContain('check-this');
    expect(reconciled.rows[1].flags).toContain('check-this');
  });

  // ---------------------------------------------------------------------------
  // 9. isSummaryOrFooterRow & non-student row filtering
  // ---------------------------------------------------------------------------
  describe('isSummaryOrFooterRow', () => {
    it('identifies official total lines', () => {
      expect(isSummaryOrFooterRow([pdfItem('Total:', 70, 500), pdfItem('153', 104, 500), pdfItem('100.0%', 124, 500)])).toBe(true);
      expect(isSummaryOrFooterRow([pdfItem('Total Students: 153', 70, 500)])).toBe(true);
      expect(isSummaryOrFooterRow([pdfItem('100.0%', 124, 500)])).toBe(true);
    });

    it('identifies grade distribution summary rows', () => {
      expect(isSummaryOrFooterRow([pdfItem('A', 70, 420), pdfItem('9', 109, 420), pdfItem('5.9%', 129, 420)])).toBe(true);
      expect(isSummaryOrFooterRow([pdfItem('A-', 70, 430), pdfItem('33', 109, 430), pdfItem('21.6%', 129, 430)])).toBe(true);
      expect(isSummaryOrFooterRow([pdfItem('Others', 70, 492), pdfItem('11', 109, 492), pdfItem('7.2%', 129, 492)])).toBe(true);
    });

    it('identifies isolated bar chart tick marks and axis categories', () => {
      expect(isSummaryOrFooterRow([pdfItem('28', 170, 364)])).toBe(true);
      expect(isSummaryOrFooterRow([pdfItem('24', 170, 396)])).toBe(true);
      expect(isSummaryOrFooterRow([pdfItem('0', 170, 480)])).toBe(true);
      expect(isSummaryOrFooterRow([pdfItem('A A- B+ B B- C+ C Others', 200, 590)])).toBe(true);
    });

    it('identifies administrative metadata and footers', () => {
      expect(isSummaryOrFooterRow([pdfItem('Entered by : Ms. M.H Paul', 47, 618)])).toBe(true);
      expect(isSummaryOrFooterRow([pdfItem('Entered Date : 4/7/2025 11:12:11 AM', 47, 630)])).toBe(true);
      expect(isSummaryOrFooterRow([pdfItem('UNIVERSITY OF SRI JAYEWARDENEPURA', 100, 50)])).toBe(true);
      expect(isSummaryOrFooterRow([pdfItem('GRADES SHEET', 100, 70)])).toBe(true);
    });

    it('does NOT filter valid student index rows', () => {
      expect(isSummaryOrFooterRow([pdfItem('ICT/23/801', 54, 100), pdfItem('A', 185, 100)])).toBe(false);
      expect(isSummaryOrFooterRow([pdfItem('ICT/23/953', 54, 100), pdfItem('B+', 185, 100)])).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. isOcrMutationOfExisting
  // ---------------------------------------------------------------------------
  describe('isOcrMutationOfExisting', () => {
    it('detects year digit misread mutations (e.g. 28, 20, 25 vs 23)', () => {
      const seen = new Map<string, number>([['ICT/23/801', 1]]);
      expect(isOcrMutationOfExisting('ICT/28/801', seen)).toBe(true);
      expect(isOcrMutationOfExisting('ICT/20/801', seen)).toBe(true);
      expect(isOcrMutationOfExisting('ICT/25/801', seen)).toBe(true);
    });

    it('detects prefix typo mutations of existing students with same sequence number', () => {
      const seen = new Map<string, number>([['ICT/23/811', 1]]);
      // prefix typo e.g. 1CT vs ICT
      expect(isOcrMutationOfExisting('1CT/23/811', seen)).toBe(true);
    });

    it('does not reject genuinely distinct students', () => {
      const seen = new Map<string, number>([['ICT/23/801', 1]]);
      expect(isOcrMutationOfExisting('ICT/23/802', seen)).toBe(false);
      expect(isOcrMutationOfExisting('ICT/23/850', seen)).toBe(false);
      expect(isOcrMutationOfExisting('ICT/23/912', seen)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 11. ReconcilePage OCR Candidate Filtering & Diagnostics
  // ---------------------------------------------------------------------------
  describe('reconcilePage OCR candidate filtering', () => {
    it('rejects OCR candidates matching wrong faculty prefixes when cohort is ICT', () => {
      const textRows: TextLayerRow[] = [
        textRow('ICT/23/801', 'A', 100),
        textRow('ICT/23/802', 'B', 114),
      ];
      // OCR candidate with AS prefix (e.g. from summary table token)
      const ocrWords: OcrWord[] = [
        ocrWord('AS/20/153', 50, 400, 200, 414),
        ocrWord('A', 210, 400, 250, 414),
      ];

      const res = reconcilePage(textRows, ocrWords, false, 2.0);
      expect(res.rows).toHaveLength(2);
      expect(res.rows.some((r) => r.indexNumber.startsWith('AS/'))).toBe(false);

      expect(res.candidateDiagnostics).toBeDefined();
      const rejected = res.candidateDiagnostics?.find((c) => c.indexCandidate === 'AS/20/153');
      expect(rejected).toBeDefined();
      expect(rejected?.accepted).toBe(false);
      expect(rejected?.rejectionReason).toContain("Mismatched faculty prefix 'AS'");
    });

    it('rejects OCR candidate that is an OCR mutation of an already extracted student', () => {
      const textRows: TextLayerRow[] = [
        textRow('ICT/23/801', 'A', 100),
      ];
      // OCR misread 23 as 28
      const ocrWords: OcrWord[] = [
        ocrWord('ICT/28/801', 50, 300, 200, 314),
        ocrWord('A', 210, 300, 250, 314),
      ];

      const res = reconcilePage(textRows, ocrWords, false, 2.0);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].indexNumber).toBe('ICT/23/801');

      const mutatedDiag = res.candidateDiagnostics?.find((c) => c.indexCandidate === 'ICT/28/801');
      expect(mutatedDiag).toBeDefined();
      expect(mutatedDiag?.accepted).toBe(false);
      expect(mutatedDiag?.rejectionReason).toContain('OCR character mutation/typo');
    });

    it('rejects false-positive OCR candidates that are optical misreads of existing text-layer rows (Page 3 regression)', () => {
      // Simulate Page 3: 50 text-layer students (ICT/23/901 to ICT/23/950) in two columns
      // 25 rows, row pitch 13.8 pt, starting at y = 261.0
      // Col 1 at x = 54.6, Col 2 at x = 312.4
      const textRows: TextLayerRow[] = [];
      for (let r = 0; r < 25; r++) {
        const y = 261.0 + r * 13.8;
        // Col 1: 901 to 925
        textRows.push({
          indexNumber: `ICT/23/${901 + r}`,
          rawIndex: `ICT/23/${901 + r}`,
          textGradeOrStatus: 'B',
          x: 54.6,
          y,
        });
        // Col 2: 926 to 950
        textRows.push({
          indexNumber: `ICT/23/${926 + r}`,
          rawIndex: `ICT/23/${926 + r}`,
          textGradeOrStatus: 'A',
          x: 312.4,
          y,
        });
      }
      expect(textRows).toHaveLength(50);

      // OCR produced optical misreads (e.g. 9 misread as 0) at the same physical row positions:
      // ICT/23/026 at row 0, col 2 (y=261.0, x=312.4, where 926 is)
      // ICT/23/028 at row 2, col 2 (y=288.6, x=312.4, where 928 is)
      // ICT/23/029 at row 3, col 2 (y=302.4, x=312.4, where 929 is)
      // ICT/23/032 at row 6, col 2 (y=343.8, x=312.4, where 932 is)
      // ICT/23/011 at row 10, col 1 (y=399.0, x=54.6, where 911 is)
      // ICT/23/013 at row 12, col 1 (y=426.6, x=54.6, where 913 is)
      // ICT/23/017 at row 16, col 1 (y=481.8, x=54.6, where 917 is)
      // ICT/23/024 at row 23, col 1 (y=578.4, x=54.6, where 924 is)
      const falsePositives = [
        { index: 'ICT/23/026', grade: 'A', x: 312.4, y: 261.0, origIdx: 'ICT/23/926' },
        { index: 'ICT/23/028', grade: 'B', x: 312.4, y: 261.0 + 2 * 13.8, origIdx: 'ICT/23/928' },
        { index: 'ICT/23/029', grade: 'B-', x: 312.4, y: 261.0 + 3 * 13.8, origIdx: 'ICT/23/929' },
        { index: 'ICT/23/032', grade: 'B', x: 312.4, y: 261.0 + 6 * 13.8, origIdx: 'ICT/23/932' },
        { index: 'ICT/23/011', grade: 'B', x: 54.6, y: 261.0 + 10 * 13.8, origIdx: 'ICT/23/911' },
        { index: 'ICT/23/013', grade: 'A', x: 54.6, y: 261.0 + 12 * 13.8, origIdx: 'ICT/23/913' },
        { index: 'ICT/23/017', grade: 'E(CA) & AB(ESA)', x: 54.6, y: 261.0 + 16 * 13.8, origIdx: 'ICT/23/917' },
        { index: 'ICT/23/024', grade: 'B', x: 54.6, y: 261.0 + 23 * 13.8, origIdx: 'ICT/23/924' },
      ];

      // Convert false positives to OCR words at scale 2.0
      const ocrWords: OcrWord[] = [];
      for (const fp of falsePositives) {
        ocrWords.push(ocrWord(fp.index, fp.x * 2.0, fp.y * 2.0, (fp.x + 60) * 2.0, (fp.y + 12) * 2.0));
        ocrWords.push(ocrWord(fp.grade, (fp.x + 70) * 2.0, fp.y * 2.0, (fp.x + 100) * 2.0, (fp.y + 12) * 2.0));
      }

      const res = reconcilePage(textRows, ocrWords, false, 2.0);

      // Must remain EXACTLY 50 students — none of the 8 false positives are added!
      expect(res.rows).toHaveLength(50);

      // Student index numbers must be the true text-layer numbers 901 to 950
      const indices = res.rows.map((r) => r.indexNumber);
      expect(indices).toContain('ICT/23/926');
      expect(indices).toContain('ICT/23/917');
      expect(indices).not.toContain('ICT/23/026');
      expect(indices).not.toContain('ICT/23/017');

      // Candidate diagnostics must document the exact rejection of each false positive
      for (const fp of falsePositives) {
        const diag = res.candidateDiagnostics?.find((c) => c.indexCandidate === fp.index);
        expect(diag).toBeDefined();
        expect(diag?.accepted).toBe(false);
        expect(diag?.rejectionReason).toContain(`already occupied by text-layer student ${fp.origIdx}`);
      }
    });
  });
});
