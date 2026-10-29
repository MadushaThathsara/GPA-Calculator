/**
 * tests/fixtures/expectedRows.ts
 *
 * Hand-written expected extraction outputs for the two sample sheets.
 * These are the ground truth used in M2/M3 extraction tests.
 *
 * Per spec §15 M0: "Store the two sample sheets as fixtures with
 * hand-written expected rows. Include 811 = A-, 825 = B-, 869 = B-."
 *
 * Known minus-sign issue (spec §5, §11):
 *   - Index 811: text layer reads "A", correct is A-
 *   - Index 825: text layer reads "B", correct is B-
 *   - Index 869: text layer reads "B", correct is B-
 *
 * The OCR reading must catch these. The "Check this" flag should be set
 * when text layer and OCR disagree.
 */

export type ExpectedRow = {
  indexNumber: string;
  /** What the PDF text layer reports (may be wrong due to minus-sign drop). */
  textLayerGrade: string | null;
  /** What OCR should report (the correct value). */
  ocrGrade: string | null;
  /** The correct working value used for GPA. */
  correctGrade: string;
  /** Whether the text layer and OCR are expected to disagree. */
  expectConflict: boolean;
};

/**
 * Sample Sheet 1 — expected rows.
 * PDF file: place at tests/fixtures/pdfs/sample1.pdf
 *
 * These values MUST be hand-verified against the actual sample sheet
 * before M2 tests are written. Populated with known values from spec §11.
 */
export const SAMPLE1_EXPECTED_ROWS: ExpectedRow[] = [
  {
    indexNumber: 'ICT/23/811',
    textLayerGrade: 'A',    // text layer drops the minus sign
    ocrGrade: 'A-',          // OCR reads correctly
    correctGrade: 'A-',
    expectConflict: true,
  },
  {
    indexNumber: 'ICT/23/825',
    textLayerGrade: 'B',    // text layer drops the minus sign
    ocrGrade: 'B-',          // OCR reads correctly
    correctGrade: 'B-',
    expectConflict: true,
  },
  {
    indexNumber: 'ICT/23/869',
    textLayerGrade: 'B',    // text layer drops the minus sign
    ocrGrade: 'B-',          // OCR reads correctly
    correctGrade: 'B-',
    expectConflict: true,
  },
  // TODO: add all remaining rows from sample1.pdf once the file is provided (spec §12)
];

/**
 * Sample Sheet 2 — expected rows.
 * PDF file: place at tests/fixtures/pdfs/sample2.pdf
 *
 * TODO: populate once the second sample sheet is provided (spec §12).
 */
export const SAMPLE2_EXPECTED_ROWS: ExpectedRow[] = [
  // TODO
];
