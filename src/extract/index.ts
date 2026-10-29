/**
 * extract/index.ts
 *
 * Public barrel for the extraction pipeline (M2 + M3).
 *
 * Per spec §14: "extract/ holds page rendering, text-layer reading,
 * OCR, reconciliation and sheet parsing."
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type { ExtractedSheet, ResultRow, IndicatorFlag, ExtractionSource } from './types';

// ── PDF text-layer (M2) ───────────────────────────────────────────────────────
export type {
  PdfTextItem,
  PdfPageData,
  SheetHeader,
  PdfExtractResult,
} from './pdfText';

export {
  ROW_Y_TOLERANCE,
  groupItemsIntoRows,
  rowToString,
  parseSheetHeader,
  normaliseIndexNumber,
  validateIndexNumber,
  INDEX_NUMBER_PATTERN,
  extractPdfPages,
  ensurePdfWorker,
  getPdfWorkerUrl,
} from './pdfText';

// ── OCR (M3) ─────────────────────────────────────────────────────────────────
export type {
  OcrWord,
  OcrPageResult,
  OcrProgressEvent,
  OcrOptions,
} from './ocr';

export {
  runOcrOnPages,
  wordCentreX,
  wordCentreY,
  groupOcrWordsIntoRows,
} from './ocr';

// ── Status parser (M3) ────────────────────────────────────────────────────────
export type {
  GradeLetter,
  StatusToken,
  ParsedCellValue,
} from './parseStatus';

export {
  parseCellValue,
  decomposeCompoundStatus,
  isValidIndexNumber,
  normaliseIndexNumber as normaliseIndexNumberStatus,
  INDEX_RE,
} from './parseStatus';

// ── Reconciliation (M3) ───────────────────────────────────────────────────────
export type {
  TextLayerRow,
  ReconcileInput,
  ReconcilePageResult,
} from './reconcile';

export {
  findRowColumns,
  extractTextLayerRows,
  matchOcrToTextRows,
  extractOcrGrade,
  reconcileRow,
  reconcilePage,
  buildTextRowsFromOcr,
} from './reconcile';
