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
 * Extracts TextLayerRow records from a set of position-grouped text rows
 * on a single page.
 *
 * Handles single-column and multi-column layouts (2 or more students side by side)
 * by splitting rows around index number tokens.
 *
 * @param rows  Output of groupItemsIntoRows() from pdfText.ts.
 */
export function extractTextLayerRows(rows: PdfTextItem[][]): TextLayerRow[] {
  const result: TextLayerRow[] = [];

  for (const rawRow of rows) {
    // Reconstruct any fragmented tokens in this row
    const sorted = reconstructRowItems(rawRow);

    // Detect all index items in the row
    const indexIndices: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const norm = normaliseIdx(sorted[i].str);
      if (norm !== null && validateIndexNumber(norm)) {
        indexIndices.push(i);
      }
    }

    if (indexIndices.length === 0) continue;

    if (indexIndices.length === 1) {
      // Single-column row
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
      // Multi-column layout: split row around each index number
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

/** Result of processing a single page through the full reconciliation pipeline. */
export interface ReconcilePageResult {
  rows: ResultRow[];
  /** Index numbers that appear more than once on the page. */
  duplicateIndexNumbers: string[];
  /** Count of rows where the index number failed the pattern. */
  invalidIndexCount: number;
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
    rows.push(row);

    // Validate index number
    if (!validateIndexNumber(row.indexNumber)) {
      invalidIndexCount++;
    }

    // Track duplicates
    const key = row.indexNumber;
    seenIndex.set(key, (seenIndex.get(key) ?? 0) + 1);
  }

  // If there was a text layer, check if OCR found additional student index rows
  if (!effectiveNoTextLayer && ocrWords.length > 0) {
    const ocrOnlyCandidates = buildTextRowsFromOcr(ocrWords, renderScale);
    for (const cand of ocrOnlyCandidates) {
      if (cand.indexNumber && !seenIndex.has(cand.indexNumber)) {
        const row = reconcileRow({
          textRow: cand,
          ocrCellText: cand.textGradeOrStatus,
          noTextLayer: true, // sole source is OCR
        });
        rows.push(row);
        seenIndex.set(cand.indexNumber, 1);
        if (!validateIndexNumber(row.indexNumber)) {
          invalidIndexCount++;
        }
      }
    }
  }

  const duplicateIndexNumbers = [...seenIndex.entries()]
    .filter(([, count]) => count > 1)
    .map(([idx]) => idx);

  return { rows, duplicateIndexNumbers, invalidIndexCount };
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
  const ocrRows = groupOcrWordsIntoRows(ocrWords);
  const result: TextLayerRow[] = [];

  for (const rawOcrRow of ocrRows) {
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
