/**
 * extract/reconcile.ts
 *
 * M3: Reconciliation of text-layer readings with OCR readings.
 *
 * Per spec §5 and §15 M3:
 *
 *   "Match text and OCR readings per cell.
 *    If they agree, accept the value.
 *    If they disagree, the OCR reading is the working value,
 *    both readings are stored, and the row is marked 'Check this'.
 *    Mark 'OCR' only where OCR is the sole source."
 *
 * The reconcile pipeline:
 *  1. For each text-layer row that contains an index number,
 *     find the matching OCR row by y-position proximity.
 *  2. Compare the grade/status cell from the text layer with the
 *     corresponding OCR word.
 *  3. Apply the agree / disagree / sole-OCR logic.
 *  4. Validate the index number; flag if invalid.
 *  5. Detect duplicate index numbers across all rows on the page.
 *
 * This module is pure (no I/O, no browser APIs) so Vitest can test it
 * directly in the node environment.
 */

import type { IndicatorFlag, ResultRow } from './types';
import { parseCellValue } from './parseStatus';
import {
  normaliseIndexNumber as normaliseIdx,
  validateIndexNumber,
  groupItemsIntoRows,
  rowToString,
  ROW_Y_TOLERANCE,
  INDEX_NUMBER_PATTERN,
  type PdfTextItem,
} from './pdfText';
import { groupOcrWordsIntoRows, wordCentreX, wordCentreY, type OcrWord } from './ocr';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One candidate row extracted from the text layer (before reconciliation). */
export interface TextLayerRow {
  /** Normalised index number (or null if normalisation fails). */
  indexNumber: string | null;
  /** Raw index token as found in the text layer. */
  rawIndex: string;
  /**
   * The grade or status cell content from the text layer.
   * May be null if the cell was empty or the column couldn't be located.
   */
  textGradeOrStatus: string | null;
  /** X coordinate (PDF user-space) of the index token. */
  x?: number;
  /** Y coordinate (PDF user-space) used for OCR row matching. */
  y: number;
}

/** Input to reconcileRow(): one text row paired with its best OCR match. */
export interface ReconcileInput {
  textRow: TextLayerRow;
  /** The OCR word(s) for the grade/status cell of this row. Null → OCR-only. */
  ocrCellText: string | null;
  /**
   * True if there was NO text layer available for this page at all
   * (e.g. a scanned image PDF).  When true and ocrCellText is present,
   * the flag becomes 'ocr' rather than 'check-this'.
   */
  noTextLayer: boolean;
}

// ---------------------------------------------------------------------------
// Column detection & Token Reconstruction
// ---------------------------------------------------------------------------

/**
 * Merges contiguous text fragments in a row when they form a student index number.
 * Handles cases where PDF text stream splits an index number across multiple items
 * (e.g. ["ITC/", "21/", "001"] or ["ITC", "/", "21", "/", "001"]).
 */
export function reconstructRowItems(row: PdfTextItem[]): PdfTextItem[] {
  if (row.length === 0) return [];
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const result: PdfTextItem[] = [];

  let i = 0;
  while (i < sorted.length) {
    let matchedToken: { text: string; endIndex: number } | null = null;

    // Check sliding window of 1 to 15 items to find index pattern
    for (let len = 1; len <= 15 && i + len <= sorted.length; len++) {
      const slice = sorted.slice(i, i + len);
      // Try combined directly
      const combined = slice.map((item) => item.str.trim()).join('');
      let norm = normaliseIdx(combined);
      if (norm !== null && validateIndexNumber(norm)) {
        matchedToken = { text: norm, endIndex: i + len };
        break;
      }

      // Try joined with slashes if slashes were separate or missing
      if (len > 1) {
        const combinedWithSlash = slice.map((item) => item.str.trim()).filter(Boolean).join('/');
        norm = normaliseIdx(combinedWithSlash);
        if (norm !== null && validateIndexNumber(norm)) {
          matchedToken = { text: norm, endIndex: i + len };
          break;
        }
      }
    }

    if (matchedToken) {
      const firstItem = sorted[i];
      const lastItem = sorted[matchedToken.endIndex - 1];
      result.push({
        str: matchedToken.text,
        x: firstItem.x,
        y: firstItem.y,
        width: lastItem.x + lastItem.width - firstItem.x,
        height: firstItem.height,
        fontSize: firstItem.fontSize,
      });
      i = matchedToken.endIndex;
    } else {
      // Also check if this single item contains an embedded index number (e.g. "1. ITC/21/045")
      const rawText = sorted[i].str.trim();
      const match = rawText.match(INDEX_NUMBER_PATTERN);
      if (match) {
        const norm = normaliseIdx(match[0]);
        if (norm && validateIndexNumber(norm)) {
          result.push({
            ...sorted[i],
            str: norm,
          });
          i++;
          continue;
        }
      }

      result.push(sorted[i]);
      i++;
    }
  }

  return result;
}

/**
 * Identifies which text item in a row is the index number and which is the
 * grade/status cell.
 *
 * Strategy:
 *  - Find the first item whose normalised form passes validateIndexNumber().
 *  - Checks for valid grades/statuses first, ignoring row/serial numbers.
 *  - For two-column sheets (two index/grade pairs per row) we return only the
 *    first pair; the caller calls this function with each column segment.
 *
 * @returns { indexItem, gradeItem } or null if no index number found.
 */
export function findRowColumns(row: PdfTextItem[]): {
  indexItem: PdfTextItem;
  gradeItem: PdfTextItem | null;
} | null {
  const sorted = reconstructRowItems(row);

  // Find index item
  const indexIdx = sorted.findIndex((item) => {
    const norm = normaliseIdx(item.str);
    return norm !== null && validateIndexNumber(norm);
  });

  if (indexIdx === -1) return null;

  const indexItem = sorted[indexIdx];
  const rightItems = sorted.slice(indexIdx + 1);

  if (rightItems.length === 0) {
    return { indexItem, gradeItem: null };
  }

  // 1. First priority: look for a known valid grade or status token
  for (const item of rightItems) {
    const trimmed = item.str.trim();
    if (!trimmed || /^\d+$/.test(trimmed)) continue; // ignore pure serial numbers (e.g. "1", "26")
    const parsed = parseCellValue(trimmed);
    if (parsed.grade !== null || parsed.statuses.length > 0) {
      return { indexItem, gradeItem: item };
    }
  }

  // 2. Second priority: look for multi-word compound statuses like "E(CA) & AB(ESA)"
  for (let len = 2; len <= rightItems.length; len++) {
    const slice = rightItems.slice(0, len);
    const combined = slice.map((i) => i.str.trim()).join(' ');
    const parsed = parseCellValue(combined);
    if (parsed.statuses.length > 0) {
      return {
        indexItem,
        gradeItem: {
          ...rightItems[0],
          str: combined,
        },
      };
    }
  }

  // 3. Fallback: filter out serial numbers & headers, check if rightmost candidate is a valid grade/status
  const candidates = rightItems.filter((item) => {
    const t = item.str.trim();
    return !/^\d+$/.test(t) && !/^(no|s\/n|sn|index|grade|status|result)$/i.test(t);
  });

  if (candidates.length > 0) {
    const last = candidates[candidates.length - 1];
    const parsed = parseCellValue(last.str.trim());
    if (parsed.grade !== null || parsed.statuses.length > 0) {
      return { indexItem, gradeItem: last };
    }
  }

  // If none of the right items is a valid grade or status, return null for gradeItem.
  // The grade is missing from the text layer (e.g. image-based in mixed PDFs) and must come from OCR.
  return { indexItem, gradeItem: null };
}

/**
 * Summary, chart, and footer text filter.
 * Prevents summary tables, chart elements, and signatures from being parsed as student rows.
 */
export function isSummaryOrFooterRow(items: PdfTextItem[]): boolean {
  if (items.length === 0) return true;
  const rowStr = items.map((it) => it.str).join(' ').trim();

  // 1. Total lines
  if (/^(?:Total|Total\s+Students|Total\s+Candidates)\s*[:=]?/i.test(rowStr)) return true;
  if (/\b(?:Total|Total\s+Students)\b/i.test(rowStr) && /\b\d+\b/.test(rowStr)) return true;
  if (/\b100(?:\.0)?%/i.test(rowStr)) return true;

  // 2. Grade distribution summary table rows (e.g. "A 9 5.9%", "A- 33 21.6%", "Others 11 7.2%")
  if (/^(?:Others|[A-E][+-]?)\s+\d+\s+[0-9.]+%/i.test(rowStr)) return true;
  if (/\b[0-9.]+%\b/.test(rowStr)) return true;

  // 3. Isolated bar chart tick marks (pure numbers with no index pattern, e.g. "28", "24", "20", "16", "12", "8", "4", "0")
  if (/^\d{1,3}$/.test(rowStr)) return true;

  // 4. Bar chart grade axis category labels (e.g. "A A- B+ B B- C+ C Others")
  if (/^(?:[A-E][+-]?\s+)+(?:Others|[A-E][+-]?)$/i.test(rowStr)) return true;

  // 5. Signatures and page/course metadata
  if (/^(?:Entered\s+by|Entered\s+Date|Marks|GRADES\s+SHEET|Date\s+of\s+Exam|Course\s+Code|Course\s+Name|Sheet\s+Number|Medium\s*:)/i.test(rowStr)) return true;
  if (/^(?:Faculty\s+of|UNIVERSITY\s+OF|Department\s+of|EXAMINATION\s+UNIT|Common\s+Module)/i.test(rowStr)) return true;
  if (/^\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\s+\d{2}-[A-Za-z]+-\d{4}$/i.test(rowStr)) return true; // timestamp footer

  return false;
}

/**
 * Extracts TextLayerRow records from a set of position-grouped text rows
 * on a single page.
 *
 * Handles single-column and multi-column layouts (2 or more students side by side)
 * by clustering student indices into coordinate columns, or splitting rows around
 * index number tokens.
 *
 * @param rows  Output of groupItemsIntoRows() from pdfText.ts.
 */
export function extractTextLayerRows(rows: PdfTextItem[][]): TextLayerRow[] {
  if (rows.length === 0) return [];

  // Filter out any row that is obviously a summary or footer row
  const dataRows = rows.filter((r) => !isSummaryOrFooterRow(r));
  const allItems = dataRows.flat();

  // Find all index candidates across all items to detect layout
  const indexItems: Array<{ item: PdfTextItem; norm: string }> = [];
  for (const it of allItems) {
    const norm = normaliseIdx(it.str);
    if (norm !== null && validateIndexNumber(norm)) {
      indexItems.push({ item: it, norm });
    }
  }

  // Also reconstruct fragmented index items if needed
  if (indexItems.length === 0) {
    for (const r of dataRows) {
      const reconstructed = reconstructRowItems(r);
      for (const it of reconstructed) {
        const norm = normaliseIdx(it.str);
        if (norm !== null && validateIndexNumber(norm)) {
          indexItems.push({ item: it, norm });
        }
      }
    }
  }

  if (indexItems.length === 0) return [];

  // Detect column splits based on horizontal clustering of student index numbers
  const xs = indexItems.map((d) => d.item.x).sort((a, b) => a - b);
  const columnSplits: number[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const gap = xs[i + 1] - xs[i];
    if (gap > 60) {
      columnSplits.push(xs[i] + gap / 2);
    }
  }

  const result: TextLayerRow[] = [];

  if (columnSplits.length > 0) {
    // Multi-column layout: partition all items into column segments
    const bounds = [-Infinity, ...columnSplits, Infinity];
    for (let c = 0; c < bounds.length - 1; c++) {
      const minX = bounds[c];
      const maxX = bounds[c + 1];
      const colItems = allItems.filter((it) => it.x >= minX && it.x < maxX);
      if (colItems.length === 0) continue;

      const colRows = groupItemsIntoRows(colItems, ROW_Y_TOLERANCE);
      for (const rawColRow of colRows) {
        if (isSummaryOrFooterRow(rawColRow)) continue;
        const sorted = reconstructRowItems(rawColRow);
        const cols = findRowColumns(sorted);
        if (!cols) continue;
        const norm = normaliseIdx(cols.indexItem.str);
        result.push({
          indexNumber: norm,
          rawIndex: cols.indexItem.str,
          textGradeOrStatus: cols.gradeItem?.str.trim() || null,
          x: cols.indexItem.x,
          y: cols.indexItem.y,
        });
      }
    }
  } else {
    // Single-column layout (or fallback)
    for (const rawRow of dataRows) {
      const sorted = reconstructRowItems(rawRow);
      const indexIndices: number[] = [];
      for (let i = 0; i < sorted.length; i++) {
        const norm = normaliseIdx(sorted[i].str);
        if (norm !== null && validateIndexNumber(norm)) {
          indexIndices.push(i);
        }
      }

      if (indexIndices.length === 0) continue;

      if (indexIndices.length === 1) {
        const cols = findRowColumns(sorted);
        if (!cols) continue;
        const norm = normaliseIdx(cols.indexItem.str);
        result.push({
          indexNumber: norm,
          rawIndex: cols.indexItem.str,
          textGradeOrStatus: cols.gradeItem?.str.trim() || null,
          x: cols.indexItem.x,
          y: cols.indexItem.y,
        });
      } else {
        for (let i = 0; i < indexIndices.length; i++) {
          const start = indexIndices[i];
          const end = i + 1 < indexIndices.length ? indexIndices[i + 1] : sorted.length;
          const segment = sorted.slice(start, end);
          const cols = findRowColumns(segment);
          if (!cols) continue;
          const norm = normaliseIdx(cols.indexItem.str);
          result.push({
            indexNumber: norm,
            rawIndex: cols.indexItem.str,
            textGradeOrStatus: cols.gradeItem?.str.trim() || null,
            x: cols.indexItem.x,
            y: cols.indexItem.y,
          });
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// OCR row matching
// ---------------------------------------------------------------------------

/**
 * Matches each TextLayerRow to the closest OCR row by y-position.
 *
 * @param textRows    Rows from the text layer.
 * @param ocrWords    All OCR words on the same page.
 * @param renderScale Scale used when rendering (to convert OCR pixel → PDF pt).
 * @param tolerance   Max y-distance (in PDF pts) to accept as a match.
 * @returns Map from TextLayerRow index → best-match OCR row words.
 */
export function matchOcrToTextRows(
  textRows: TextLayerRow[],
  ocrWords: OcrWord[],
  renderScale: number = 2.0,
  tolerance: number = 14,
): Map<number, OcrWord[]> {
  const ocrRows = groupOcrWordsIntoRows(ocrWords);
  const matches = new Map<number, OcrWord[]>();

  for (let ti = 0; ti < textRows.length; ti++) {
    const textY = textRows[ti].y;
    let bestRow: OcrWord[] | null = null;
    let bestDist = Infinity;

    for (const ocrRow of ocrRows) {
      if (ocrRow.length === 0) continue;
      // Convert OCR pixel y to PDF pts, using both top edge and center for robust alignment
      const ocrTopY = ocrRow[0].bbox.y0 / renderScale;
      const ocrCenterY = wordCentreY(ocrRow[0]) / renderScale;
      const dist = Math.min(Math.abs(ocrTopY - textY), Math.abs(ocrCenterY - textY));
      if (dist < bestDist && dist <= tolerance) {
        bestDist = dist;
        bestRow = ocrRow;
      }
    }

    if (bestRow !== null) {
      matches.set(ti, bestRow);
    }
  }

  return matches;
}

/**
 * Extracts the grade/status cell text from an OCR row that corresponds to
 * a specific student candidate row.
 *
 * Supports multi-column result sheets by restricting the OCR candidate window
 * between this student's x coordinate and the next student's x coordinate on the same line.
 *
 * @returns The concatenated grade/status token, or null if not found.
 */
export function extractOcrGrade(
  ocrRow: OcrWord[],
  textRow?: TextLayerRow,
  renderScale: number = 2.0,
  nextTextRowOnSameLine?: TextLayerRow,
): string | null {
  if (ocrRow.length === 0) return null;
  const sorted = [...ocrRow].sort((a, b) => a.bbox.x0 - b.bbox.x0);

  // If textRow spatial information is available, restrict OCR search window horizontally
  let candidateWords = sorted;
  if (textRow && typeof textRow.x === 'number') {
    const minX = textRow.x * renderScale - 10;
    const maxX =
      nextTextRowOnSameLine && typeof nextTextRowOnSameLine.x === 'number'
        ? nextTextRowOnSameLine.x * renderScale - 10
        : Infinity;

    const columnWords = sorted.filter((w) => {
      const cx = wordCentreX(w);
      return cx >= minX && cx < maxX;
    });

    if (columnWords.length > 0) {
      candidateWords = columnWords;
    }
  }

  // 1. Check if candidateWords contains an index number
  const idxPos = candidateWords.findIndex((w) => {
    const norm = normaliseIdx(w.text);
    return norm !== null && validateIndexNumber(norm);
  });

  if (idxPos !== -1) {
    const right = candidateWords.slice(idxPos + 1);
    // Check compound status first
    for (let len = 2; len <= right.length; len++) {
      const combined = right.slice(0, len).map((w) => w.text.trim()).join(' ');
      const parsed = parseCellValue(combined);
      if (parsed.statuses.length > 0) return combined;
    }
    // Check combined 2-token grades (e.g. ['A', '-'] or ['B', '-']) to preserve minus signs
    for (let i = 0; i < right.length - 1; i++) {
      const combined = `${right[i].text.trim()}${right[i + 1].text.trim()}`;
      const parsed = parseCellValue(combined);
      if (parsed.grade !== null) return parsed.grade;
    }
    // Check single valid grade/status token
    for (const w of right) {
      const parsed = parseCellValue(w.text.trim());
      if (parsed.grade !== null || parsed.statuses.length > 0) {
        return w.text.trim();
      }
    }
    if (right.length > 0) {
      return right[right.length - 1].text.trim() || null;
    }
  }

  // 2. If no index number in candidate OCR words (e.g. mixed PDF where index is text and grade is image)
  // Check for compound status in candidate words
  for (let len = 2; len <= candidateWords.length; len++) {
    const combined = candidateWords.slice(0, len).map((w) => w.text.trim()).join(' ');
    const parsed = parseCellValue(combined);
    if (parsed.statuses.length > 0) return combined;
  }

  // Check combined 2-token grades (e.g. ['A', '-'] or ['B', '-']) from right to left to preserve minus signs
  for (let i = candidateWords.length - 2; i >= 0; i--) {
    const combined = `${candidateWords[i].text.trim()}${candidateWords[i + 1].text.trim()}`;
    const parsed = parseCellValue(combined);
    if (parsed.grade !== null) return parsed.grade;
  }

  // Check from right to left for a single valid grade or status token
  for (let i = candidateWords.length - 1; i >= 0; i--) {
    const w = candidateWords[i];
    const parsed = parseCellValue(w.text.trim());
    if (parsed.grade !== null || parsed.statuses.length > 0) {
      return w.text.trim();
    }
  }

  // Fallback: check rightmost non-serial word
  const nonSerial = candidateWords.filter((w) => !/^\d+$/.test(w.text.trim()));
  if (nonSerial.length > 0) {
    const last = nonSerial[nonSerial.length - 1].text.trim();
    const parsed = parseCellValue(last);
    if (parsed.grade !== null || parsed.statuses.length > 0) {
      return last;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Core reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconciles a single text-layer row with its OCR counterpart.
 *
 * Decision table (spec §5):
 * ┌─────────────────────┬──────────────────────┬─────────────────────────────┐
 * │  textGradeOrStatus  │   ocrCellText        │  Result                     │
 * ├─────────────────────┼──────────────────────┼─────────────────────────────┤
 * │  present            │  same (normalised)   │  working=text; flag: agreed │
 * │  present            │  different           │  working=ocr; flag: check   │
 * │  present            │  null                │  working=text; flag: (none) │
 * │  null               │  present             │  working=ocr; flag: ocr     │
 * │  null               │  null                │  working=''; flag: check    │
 * │  (no text layer)    │  present             │  working=ocr; flag: ocr     │
 * └─────────────────────┴──────────────────────┴─────────────────────────────┘
 *
 * @returns A partial ResultRow (no indexNumber validation applied yet).
 */
export function reconcileRow(input: ReconcileInput): ResultRow {
  const { textRow, ocrCellText, noTextLayer } = input;

  const textVal = textRow.textGradeOrStatus?.trim() || null;
  const ocrVal = ocrCellText?.trim() || null;
  const indexNumber = textRow.indexNumber ?? textRow.rawIndex;

  const flags: IndicatorFlag[] = [];
  let textReading: string | null = textVal;
  let ocrReading: string | null = ocrVal;
  let workingValue: string;

  // Determine source / working value
  if (noTextLayer || textVal === null) {
    // No text layer grade available → OCR is the sole source
    workingValue = ocrVal ?? textVal ?? '';
    if (workingValue) {
      flags.push('ocr');
    } else {
      // Both text and OCR are missing/unrecovered -> flag for manual review
      flags.push('check-this');
    }
    textReading = null;
  } else if (ocrVal === null) {
    // Only text layer available
    workingValue = textVal;
    const parsedText = parseCellValue(textVal);
    if (parsedText.grade === null && parsedText.statuses.length === 0) {
      flags.push('check-this');
    }
  } else {
    // Both available: compare (case-insensitive, whitespace normalised)
    const textNorm = textVal.replace(/\s+/g, ' ').toUpperCase();
    const ocrNorm = ocrVal.replace(/\s+/g, ' ').toUpperCase();
    if (textNorm === ocrNorm) {
      workingValue = textVal; // agreed
    } else {
      // Disagreement: OCR wins, flag 'check-this'
      workingValue = ocrVal;
      flags.push('check-this');
    }
  }

  // Parse the working value
  const parsed = parseCellValue(workingValue);

  return {
    indexNumber,
    textReading,
    ocrReading,
    workingValue,
    grade: parsed.grade,
    status: parsed.statuses.length > 0 ? parsed.statuses[0] : null,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Page-level pipeline
// ---------------------------------------------------------------------------

/** Candidate diagnostic records for tracking accepted & rejected rows. */
export interface CandidateDiagnostic {
  source: 'text' | 'ocr';
  indexCandidate: string;
  gradeCandidate?: string;
  accepted: boolean;
  rejectionReason?: string;
}

/**
 * Detects if an OCR-recognized candidate index number is merely a character mutation
 * (e.g. 23 misread as 28 or 20, or a single character OCR typo in prefix/year) of an already seen student.
 */
export function isOcrMutationOfExisting(candidate: string, seen: Map<string, unknown>): boolean {
  if (seen.has(candidate)) return true;
  const candParts = candidate.split('/');
  if (candParts.length !== 3) return false;
  const [candPref, candYr, candSeq] = candParts;

  for (const existing of seen.keys()) {
    const exParts = existing.split('/');
    if (exParts.length !== 3) continue;
    const [exPref, exYr, exSeq] = exParts;

    // Same sequence number (e.g. 801) but year digit misread (e.g. 28, 20, 25 vs 23)
    if (candPref === exPref && candSeq === exSeq && candYr !== exYr) {
      return true;
    }
    // Same sequence number and same year, but prefix slightly misread (e.g. 1CT vs ICT)
    if (candYr === exYr && candSeq === exSeq && candPref !== exPref) {
      return true;
    }
  }
  return false;
}

/** Result of processing a single page through the full reconciliation pipeline. */
export interface ReconcilePageResult {
  rows: ResultRow[];
  /** Index numbers that appear more than once on the page. */
  duplicateIndexNumbers: string[];
  /** Count of rows where the index number failed the pattern. */
  invalidIndexCount: number;
  /** Candidate diagnostics for tracking accepted & rejected candidates on this page. */
  candidateDiagnostics?: CandidateDiagnostic[];
}

/**
 * Full reconciliation pipeline for a single PDF page.
 *
 * @param textRows     Result of extractTextLayerRows().
 * @param ocrWords     All OcrWords for the page (empty array if OCR failed).
 * @param noTextLayer  True when the PDF page had no text layer at all.
 * @param renderScale  Scale used to render the page (for coordinate conversion).
 */
export function reconcilePage(
  textRows: TextLayerRow[],
  ocrWords: OcrWord[],
  noTextLayer: boolean = false,
  renderScale: number = 2.0,
): ReconcilePageResult {
  const isImageOnly = noTextLayer || textRows.length === 0;
  const effectiveTextRows = isImageOnly ? buildTextRowsFromOcr(ocrWords, renderScale) : textRows;
  const effectiveNoTextLayer = isImageOnly;

  const ocrMap = matchOcrToTextRows(effectiveTextRows, ocrWords, renderScale);
  const rows: ResultRow[] = [];
  const rowByIndex = new Map<string, ResultRow>();
  const seenIndex = new Map<string, number>(); // normalised index → count
  let invalidIndexCount = 0;

  for (let i = 0; i < effectiveTextRows.length; i++) {
    const textRow = effectiveTextRows[i];
    const ocrRowWords = ocrMap.get(i) ?? null;

    // Find next student on the same physical line to establish column boundary
    const nextTextRowOnSameLine = effectiveTextRows.find(
      (other, otherIdx) =>
        otherIdx !== i &&
        Math.abs(other.y - textRow.y) <= ROW_Y_TOLERANCE &&
        (other.x ?? 0) > (textRow.x ?? 0),
    );

    const ocrCellText = ocrRowWords
      ? extractOcrGrade(ocrRowWords, textRow, renderScale, nextTextRowOnSameLine)
      : null;

    const row = reconcileRow({
      textRow,
      ocrCellText,
      noTextLayer: effectiveNoTextLayer,
    });

    // Validate index number
    if (!validateIndexNumber(row.indexNumber)) {
      invalidIndexCount++;
    }

    // Track duplicates and detect conflicts
    const key = row.indexNumber;
    if (seenIndex.has(key)) {
      seenIndex.set(key, seenIndex.get(key)! + 1);
      const existing = rowByIndex.get(key);
      if (existing && existing.workingValue !== row.workingValue) {
        if (!existing.flags.includes('check-this')) {
          existing.flags.push('check-this');
        }
        if (!row.flags.includes('check-this')) {
          row.flags.push('check-this');
        }
      }
    } else {
      seenIndex.set(key, 1);
      rowByIndex.set(key, row);
    }

    rows.push(row);
  }

  const candidateDiagnostics: CandidateDiagnostic[] = [];

  // If there was a text layer, check if OCR found additional student index rows
  if (!effectiveNoTextLayer && ocrWords.length > 0) {
    // Collect established cohort prefixes from text layer on this page
    const establishedPrefixes = new Set<string>();
    for (const r of effectiveTextRows) {
      if (r.indexNumber) {
        const parts = r.indexNumber.split('/');
        if (parts[0]) establishedPrefixes.add(parts[0]);
      }
    }

    // Collect established index column X coordinates from text layer on this page
    const establishedColXs = effectiveTextRows
      .map((r) => r.x)
      .filter((x): x is number => typeof x === 'number');

    const ocrOnlyCandidates = buildTextRowsFromOcr(ocrWords, renderScale);
    for (const cand of ocrOnlyCandidates) {
      if (!cand.indexNumber || !validateIndexNumber(cand.indexNumber)) {
        if (cand.indexNumber) {
          candidateDiagnostics.push({
            source: 'ocr',
            indexCandidate: cand.indexNumber,
            gradeCandidate: cand.textGradeOrStatus || undefined,
            accepted: false,
            rejectionReason: 'Does not match recognized university index pattern',
          });
        }
        continue;
      }

      // 1. Spatial Table-Cell Occupancy Check (Requirements 2 & 3):
      // In a printed tabular result sheet, each cell contains exactly one student record.
      // If a text-layer student is already located at this (x, y) cell (within vertical row
      // tolerance and horizontal column tolerance), any OCR candidate here with a different
      // index number is an OCR optical misread of that existing student (e.g. 9 misread as 0).
      const candY = cand.y;
      const candX = cand.x;
      const occupyingTextRow = effectiveTextRows.find((tr) => {
        // Vertical row proximity (within 10 pt of text row)
        const yDist = Math.abs(tr.y - candY);
        if (yDist > 10) return false;

        // Horizontal column proximity if both X coordinates are known
        if (typeof tr.x === 'number' && typeof candX === 'number') {
          return Math.abs(tr.x - candX) <= 60;
        }
        return true;
      });

      if (occupyingTextRow) {
        // If the OCR candidate matches the existing row's index, it was already reconciled in primary pass.
        // If it differs, OCR misread the text-layer student at this row (e.g. ICT/23/026 vs ICT/23/926).
        const isSameStudent = occupyingTextRow.indexNumber === cand.indexNumber;
        if (!isSameStudent) {
          candidateDiagnostics.push({
            source: 'ocr',
            indexCandidate: cand.indexNumber,
            gradeCandidate: cand.textGradeOrStatus || undefined,
            accepted: false,
            rejectionReason: `Table row position (x: ${candX !== undefined ? candX.toFixed(1) : '?'}, y: ${candY.toFixed(1)}) is already occupied by text-layer student ${occupyingTextRow.indexNumber} (OCR misread of existing row)`,
          });
        }
        continue;
      }

      // 2. Expected Column Alignment Check (Requirement 3):
      // When text-layer rows exist, any genuine missing student must align horizontally with an established index column.
      if (typeof candX === 'number' && establishedColXs.length > 0) {
        const alignsWithIndexColumn = establishedColXs.some((colX) => Math.abs(colX - candX) <= 45);
        if (!alignsWithIndexColumn) {
          candidateDiagnostics.push({
            source: 'ocr',
            indexCandidate: cand.indexNumber,
            gradeCandidate: cand.textGradeOrStatus || undefined,
            accepted: false,
            rejectionReason: `Candidate X-coordinate (${candX.toFixed(1)}) does not align with any established student index column`,
          });
          continue;
        }
      }

      // 3. Faculty/Cohort Prefix Check (Requirement 4):
      const candPrefix = cand.indexNumber.split('/')[0];
      if (establishedPrefixes.size > 0 && !establishedPrefixes.has(candPrefix)) {
        candidateDiagnostics.push({
          source: 'ocr',
          indexCandidate: cand.indexNumber,
          gradeCandidate: cand.textGradeOrStatus || undefined,
          accepted: false,
          rejectionReason: `Mismatched faculty prefix '${candPrefix}' (cohort prefix is '${[...establishedPrefixes].join(', ')}')`,
        });
        continue;
      }

      // 4. Duplicate / Mutation Check:
      if (seenIndex.has(cand.indexNumber)) {
        candidateDiagnostics.push({
          source: 'ocr',
          indexCandidate: cand.indexNumber,
          gradeCandidate: cand.textGradeOrStatus || undefined,
          accepted: false,
          rejectionReason: `Duplicate student record (${cand.indexNumber} already extracted)`,
        });
        continue;
      }

      if (isOcrMutationOfExisting(cand.indexNumber, seenIndex)) {
        candidateDiagnostics.push({
          source: 'ocr',
          indexCandidate: cand.indexNumber,
          gradeCandidate: cand.textGradeOrStatus || undefined,
          accepted: false,
          rejectionReason: 'OCR character mutation/typo of existing student record',
        });
        continue;
      }

      // 5. Valid Grade/Status Check:
      if (
        cand.textGradeOrStatus !== null &&
        cand.textGradeOrStatus.trim().length > 0
      ) {
        const row = reconcileRow({
          textRow: cand,
          ocrCellText: cand.textGradeOrStatus,
          noTextLayer: true, // sole source is OCR
        });
        // Per Requirement 5: If a candidate cannot be verified confidently, flag it for review
        if (!row.flags.includes('check-this')) {
          row.flags.push('check-this');
        }
        rows.push(row);
        seenIndex.set(cand.indexNumber, 1);
        rowByIndex.set(cand.indexNumber, row);
        if (!validateIndexNumber(row.indexNumber)) {
          invalidIndexCount++;
        }
        candidateDiagnostics.push({
          source: 'ocr',
          indexCandidate: cand.indexNumber,
          gradeCandidate: cand.textGradeOrStatus,
          accepted: true,
        });
      } else {
        candidateDiagnostics.push({
          source: 'ocr',
          indexCandidate: cand.indexNumber,
          gradeCandidate: undefined,
          accepted: false,
          rejectionReason: 'No valid grade or examination status associated with OCR candidate',
        });
      }
    }
  }

  const duplicateIndexNumbers = [...seenIndex.entries()]
    .filter(([, count]) => count > 1)
    .map(([idx]) => idx);

  return { rows, duplicateIndexNumbers, invalidIndexCount, candidateDiagnostics };
}

// ---------------------------------------------------------------------------
// OCR-only path (no text layer)
// ---------------------------------------------------------------------------

/**
 * Merges contiguous OCR words in a row when they form an index number token.
 */
export function reconstructOcrWords(words: OcrWord[]): OcrWord[] {
  if (words.length === 0) return [];
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const result: OcrWord[] = [];

  let i = 0;
  while (i < sorted.length) {
    let matchedToken: { text: string; endIndex: number } | null = null;
    for (let len = 1; len <= 15 && i + len <= sorted.length; len++) {
      const slice = sorted.slice(i, i + len);
      const combined = slice.map((w) => w.text.trim()).join('');
      let norm = normaliseIdx(combined);
      if (norm !== null && validateIndexNumber(norm)) {
        matchedToken = { text: norm, endIndex: i + len };
        break;
      }

      if (len > 1) {
        const combinedWithSlash = slice.map((w) => w.text.trim()).filter(Boolean).join('/');
        norm = normaliseIdx(combinedWithSlash);
        if (norm !== null && validateIndexNumber(norm)) {
          matchedToken = { text: norm, endIndex: i + len };
          break;
        }
      }
    }

    if (matchedToken) {
      const firstWord = sorted[i];
      const lastWord = sorted[matchedToken.endIndex - 1];
      result.push({
        text: matchedToken.text,
        confidence: firstWord.confidence,
        bbox: {
          x0: firstWord.bbox.x0,
          y0: firstWord.bbox.y0,
          x1: lastWord.bbox.x1,
          y1: lastWord.bbox.y1,
        },
      });
      i = matchedToken.endIndex;
    } else {
      const rawText = sorted[i].text.trim();
      const match = rawText.match(INDEX_NUMBER_PATTERN);
      if (match) {
        const norm = normaliseIdx(match[0]);
        if (norm && validateIndexNumber(norm)) {
          result.push({
            ...sorted[i],
            text: norm,
          });
          i++;
          continue;
        }
      }

      result.push(sorted[i]);
      i++;
    }
  }

  return result;
}

/**
 * Builds TextLayerRow records from OCR words alone (image-only PDF pages).
 *
 * Used when the PDF has no text layer. Groups OCR words into rows, finds
 * the index number in each row, and constructs a TextLayerRow so the
 * standard reconcileRow() path can be used with noTextLayer=true.
 *
 * @param ocrWords   All OCR words on the page.
 * @param renderScale Scale used for rendering (to convert pixel→pt if needed).
 */
export function buildTextRowsFromOcr(
  ocrWords: OcrWord[],
  renderScale: number = 2.0,
): TextLayerRow[] {
  // Filter out OCR words that belong to summary tables or footers
  const filteredWords = ocrWords.filter((w) => {
    const t = w.text.trim();
    if (!t) return false;
    if (/^(?:Total:|Total|Others|100\.0%|100%|Entered|Marks)$/i.test(t)) return false;
    if (/\b\d+(?:\.\d+)?%\b/.test(t)) return false;
    return true;
  });

  const ocrRows = groupOcrWordsIntoRows(filteredWords);
  const result: TextLayerRow[] = [];

  for (const rawOcrRow of ocrRows) {
    // Skip rows matching summary or chart patterns
    const lineText = rawOcrRow.map((w) => w.text).join(' ');
    if (
      /\b(?:Total|Total\s+Students|Total\s+Candidates|100(?:\.0)?%|Entered\s+by|Entered\s+Date|Others|\d+%\b)\b/i.test(lineText) ||
      /^(?:Others|[A-E][+-]?)\s+\d+\s+[0-9.]+%/i.test(lineText) ||
      /^\d{1,3}$/.test(lineText.trim())
    ) {
      continue;
    }

    const ocrRow = reconstructOcrWords(rawOcrRow);
    const sorted = [...ocrRow].sort((a, b) => a.bbox.x0 - b.bbox.x0);

    // Find all index words in this OCR row (handles multi-column layout)
    const indexIndices: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const norm = normaliseIdx(sorted[i].text);
      if (norm !== null && validateIndexNumber(norm)) {
        indexIndices.push(i);
      }
    }
    if (indexIndices.length === 0) continue;

    for (let i = 0; i < indexIndices.length; i++) {
      const start = indexIndices[i];
      const end = i + 1 < indexIndices.length ? indexIndices[i + 1] : sorted.length;
      const segment = sorted.slice(start, end);
      const idxWord = segment[0];
      const norm = normaliseIdx(idxWord.text);
      const grade = extractOcrGrade(segment);

      result.push({
        indexNumber: norm,
        rawIndex: idxWord.text,
        textGradeOrStatus: grade,
        x: idxWord.bbox.x0 / renderScale,
        y: idxWord.bbox.y0 / renderScale,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Re-export groupItemsIntoRows for convenience in tests
// ---------------------------------------------------------------------------
export { groupItemsIntoRows, rowToString, ROW_Y_TOLERANCE };
