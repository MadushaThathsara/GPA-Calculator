/**
 * extract/types.ts
 *
 * Types for the extraction pipeline output.
 * Matches the data model from spec §7.
 */

/** Confidence source for an extracted value. */
export type ExtractionSource =
  | 'text'   // from PDF text layer only
  | 'ocr'    // from OCR only (no usable text layer) → badge: OCR
  | 'agreed' // text and OCR agree
  | 'conflict'; // text and OCR disagree → badge: Check this

/** Indicator flags per spec §5. */
export type IndicatorFlag = 'ocr' | 'check-this' | 'edited';

/** A single extracted result row (one student, one module). */
export interface ResultRow {
  /** Normalised index number, e.g. "ICT/23/811". */
  indexNumber: string;
  /** Raw text from the text layer (may contain minus-sign drops). */
  textReading: string | null;
  /** Raw text from OCR. */
  ocrReading: string | null;
  /** Working value used for calculations (OCR wins on disagreement). */
  workingValue: string;
  /** Resolved grade, if applicable. */
  grade: string | null;
  /** Status code, if applicable. */
  status: string | null;
  /** Extraction indicators for this row. */
  flags: IndicatorFlag[];
}

/** One parsed result sheet. */
export interface ExtractedSheet {
  /** Computed display file name: <CourseCode>_<CourseName>.pdf */
  displayName: string;
  courseCode: string;
  courseName: string;
  academicYear: number | null;
  semesterNumber: number | null;
  examYear: string | null;
  examSession: string | null;
  type: 'original' | 'repeat-resit';
  /** All result rows from this sheet. */
  rows: ResultRow[];
  /** Estimated row count from page image (for mismatch warning). */
  estimatedRowCount: number | null;
  /** Actual extracted row count. */
  extractedRowCount: number;
}
