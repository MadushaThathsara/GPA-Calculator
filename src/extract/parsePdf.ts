/**
 * extract/parsePdf.ts
 *
 * Core PDF parsing pipeline:
 *  1. Render each page to canvas at 2.0x scale via PDF.js.
 *  2. Extract selectable text layer items.
 *  3. Run Tesseract OCR on rendered page images.
 *  4. Reconcile text layer with OCR.
 *  5. Extract header metadata (course code, name, academic year, semester, exam year, printed total).
 *  6. Return the constructed MockSheet and ExtractionDiagnostics.
 */

import type { MockSheet, MockResultRow } from '../store/useSessionStore';
import {
  extractPdfPages,
  ensurePdfWorker,
  normaliseIndexNumber,
  parseHeaderFromText,
  extractAcademicYear,
  extractPrintedTotal,
} from './pdfText';
import { extractTextLayerRows, reconcilePage, isSummaryOrFooterRow } from './reconcile';
import { runOcrOnPages, type OcrPageResult } from './ocr';

export interface ExtractionDiagnostics {
  fileName: string;
  pageCount: number;
  pdfTextStats: Array<{
    pageNumber: number;
    charCount: number;
    itemCount: number;
  }>;
  renderStats: Array<{
    pageNumber: number;
    renderSuccess: boolean;
    canvasWidth: number;
    canvasHeight: number;
    hasNonEmptyImageData: boolean;
    imageInputType: string;
    error?: string;
  }>;
  ocrStats: Array<{
    pageNumber: number;
    completed: boolean;
    charCount: number;
    wordCount: number;
    sampleText: string;
    error?: string;
    errorStack?: string;
  }>;
  candidateRows: Array<{
    pageNumber: number;
    source: 'text' | 'ocr';
    indexCandidate?: string;
    gradeCandidate?: string;
    accepted: boolean;
    rejectionReason?: string;
  }>;
  summaryReason: string;
  printedTotal?: number | null;
  extractedCount?: number;
}

export interface ParsePdfCallbacks {
  onStatus?: (msg: string) => void;
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}

export interface ParsePdfResult {
  sheet: MockSheet;
  diagnostics: ExtractionDiagnostics;
}

export async function parsePdfFile(
  file: File,
  callbacks?: ParsePdfCallbacks,
): Promise<ParsePdfResult> {
  const { onStatus, onProgress, signal } = callbacks ?? {};

  onStatus?.(`Loading ${file.name}…`);
  await ensurePdfWorker();
  const buffer = await file.arrayBuffer();

  if (signal?.aborted) {
    throw new Error('Upload cancelled by user.');
  }

  // Step 1: Render each PDF page to canvas and extract text items
  onStatus?.(`Rendering pages for ${file.name}…`);
  const extractResult = await extractPdfPages(buffer, 2.0, (current, total) => {
    onProgress?.(Math.round((current / total) * 35));
  });

  if (!extractResult.pages || extractResult.pages.length === 0) {
    throw new Error(`The file "${file.name}" contains no renderable PDF pages.`);
  }

  if (signal?.aborted) {
    throw new Error('Upload cancelled by user.');
  }

  const diag: ExtractionDiagnostics = {
    fileName: file.name,
    pageCount: extractResult.pages.length,
    pdfTextStats: [],
    renderStats: [],
    ocrStats: [],
    candidateRows: [],
    summaryReason: '',
  };

  for (const p of extractResult.pages) {
    const chars = p.textItems.reduce((acc, it) => acc + it.str.length, 0);
    diag.pdfTextStats.push({
      pageNumber: p.pageNumber,
      charCount: chars,
      itemCount: p.textItems.length,
    });
    diag.renderStats.push({
      pageNumber: p.pageNumber,
      renderSuccess: p.canvasWidth > 0 && p.canvasHeight > 0,
      canvasWidth: p.canvasWidth,
      canvasHeight: p.canvasHeight,
      hasNonEmptyImageData: (p.imageData?.data?.length ?? 0) > 0 || Boolean(p.imageUrl),
      imageInputType: p.imageUrl ? 'image/png (Data URL)' : (p.imageBlob ? 'image/png (Blob)' : 'ImageData (converted)'),
    });
  }

  const header = extractResult.header;
  let courseCode = header.courseCode;
  let courseName = header.courseName;
  let semesterNumber = header.semesterNumber;
  let examYear = header.examYear;
  let examSession = header.examSession;

  // Step 2: Execute Tesseract OCR across all rendered page canvases
  onStatus?.(`Scanning page images with OCR…`);
  let ocrResults: OcrPageResult[] = [];
  let ocrErrorStr: string | null = null;
  try {
    ocrResults = await runOcrOnPages(
      extractResult.pages.map((p) => ({
        pageNumber: p.pageNumber,
        imageUrl: p.imageUrl,
        imageBlob: p.imageBlob,
        imageData: p.imageData,
        image: p.imageUrl || p.imageBlob || p.imageData,
      })),
      {
        renderScale: 2.0,
        onProgress: (evt) => {
          const ocrPct = 35 + Math.round((evt.currentPage / evt.totalPages) * 55);
          onProgress?.(ocrPct);
          onStatus?.(`OCR scanning page ${evt.currentPage} of ${evt.totalPages}…`);
        },
        signal,
      },
    );

    for (const p of extractResult.pages) {
      const pageOcr = ocrResults.find((o) => o.pageNumber === p.pageNumber);
      diag.ocrStats.push({
        pageNumber: p.pageNumber,
        completed: Boolean(pageOcr),
        charCount: pageOcr?.fullText.length ?? 0,
        wordCount: pageOcr?.words.length ?? 0,
        sampleText: (pageOcr?.fullText ?? '').slice(0, 140).replace(/\s+/g, ' ').trim(),
      });
    }
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('Upload cancelled by user.');
    }
    const errObj = err as Error;
    ocrErrorStr = errObj?.message || String(err);
    const ocrStack = errObj?.stack || '';
    for (const p of extractResult.pages) {
      diag.ocrStats.push({
        pageNumber: p.pageNumber,
        completed: false,
        charCount: 0,
        wordCount: 0,
        sampleText: '',
        error: ocrErrorStr,
        errorStack: ocrStack,
      });
    }
    console.warn('OCR execution encountered a warning, proceeding with available data:', err);
  }

  // Header recovery: If text layer had no header fields (e.g. image-only PDF), check OCR across ALL pages
  if ((!courseCode || !examSession) && ocrResults.length > 0) {
    for (const pageOcr of ocrResults) {
      if (!pageOcr?.fullText) continue;
      const ocrHeader = parseHeaderFromText(pageOcr.fullText);
      if (!courseCode && ocrHeader.courseCode) {
        courseCode = ocrHeader.courseCode;
        if (!courseName && ocrHeader.courseName) courseName = ocrHeader.courseName;
      }
      if (!examSession && ocrHeader.examSession) {
        semesterNumber = ocrHeader.semesterNumber;
        examYear = ocrHeader.examYear;
        examSession = ocrHeader.examSession;
      }
      if (courseCode && examSession) break;
    }
  }

  // Only if still missing course code, fall back to filename regex
  if (!courseCode) {
    const fileCodeMatch = file.name.match(/([A-Z]{2,4}\s*\d{4})/i);
    courseCode = fileCodeMatch ? fileCodeMatch[1].replace(/\s+/g, '').toUpperCase() : 'UNKNOWN_COURSE';
  }
  const inferredName = file.name.replace(/\.pdf$/i, '').replace(/^[A-Z]{2,4}\s*\d{4}\s*[-_]?\s*/i, '').trim();
  courseName = courseName || inferredName || 'University Examination';

  // Derive academic year from the module code
  const academicYear = extractAcademicYear(courseCode);

  const semesterWarning = !examSession
    ? 'Examination semester heading could not be identified from the PDF. Please assign the semester manually.'
    : null;

  const academicYearWarning = courseCode && academicYear === null
    ? `Academic year could not be determined from module code "${courseCode}".`
    : null;

  // Step 3: Reconcile text-layer with OCR for every page
  onStatus?.(`Reconciling text & OCR readings…`);
  onProgress?.(95);

  const allRows: MockResultRow[] = [];
  const seenIndices = new Map<string, MockResultRow>();

  for (const page of extractResult.pages) {
    const textRows = extractTextLayerRows(page.rows);
    const pageOcr = ocrResults.find((o) => o.pageNumber === page.pageNumber);
    const ocrWords = pageOcr ? pageOcr.words : [];

    // Record text-layer candidate rows for diagnostics
    for (const tr of textRows) {
      diag.candidateRows.push({
        pageNumber: page.pageNumber,
        source: 'text',
        indexCandidate: tr.indexNumber || tr.rawIndex,
        gradeCandidate: tr.textGradeOrStatus || undefined,
        accepted: true,
      });
    }

    // Record non-student rows from page.rows for diagnostics
    for (const rawRow of page.rows) {
      if (isSummaryOrFooterRow(rawRow)) {
        const rowStr = rawRow.map((it) => it.str).join(' ').trim();
        diag.candidateRows.push({
          pageNumber: page.pageNumber,
          source: 'text',
          indexCandidate: rowStr.slice(0, 36),
          gradeCandidate: undefined,
          accepted: false,
          rejectionReason: 'Summary table, chart element, or administrative metadata',
        });
      }
    }

    const reconciled = reconcilePage(textRows, ocrWords, textRows.length === 0, 2.0);

    // Record any OCR candidates (both accepted and rejected) for diagnostics
    if (reconciled.candidateDiagnostics) {
      for (const cd of reconciled.candidateDiagnostics) {
        diag.candidateRows.push({
          pageNumber: page.pageNumber,
          source: cd.source,
          indexCandidate: cd.indexCandidate,
          gradeCandidate: cd.gradeCandidate,
          accepted: cd.accepted,
          rejectionReason: cd.rejectionReason,
        });
      }
    }

    for (const r of reconciled.rows) {
      if (!r.indexNumber) continue;
      const norm = normaliseIndexNumber(r.indexNumber);
      if (!norm) continue;

      const existing = seenIndices.get(norm);
      if (existing) {
        // Track duplicate rejection in candidateRows
        const crEntry = diag.candidateRows.find(
          (c) => c.pageNumber === page.pageNumber && c.indexCandidate === norm && c.accepted,
        );
        if (crEntry) {
          crEntry.accepted = false;
          crEntry.rejectionReason = `Duplicate student record (${norm} already registered on earlier row/page)`;
        }

        // Detect conflict across pages or duplicate lines
        const existingVal = (existing.grade ?? existing.status ?? '').trim().toUpperCase();
        const newVal = (r.grade ?? r.status ?? '').trim().toUpperCase();
        if (existingVal && newVal && existingVal !== newVal) {
          if (!existing.flags.includes('check-this')) {
            existing.flags.push('check-this');
          }
          existing.textReading = existing.textReading
            ? `${existing.textReading} | conflict: ${newVal}`
            : `conflict: ${existingVal} vs ${newVal}`;
        }
        continue;
      }

      const newRow: MockResultRow = {
        indexNumber: norm,
        moduleCode: courseCode,
        grade: r.grade,
        status: r.status,
        flags: [...r.flags],
        textReading: r.textReading,
        ocrReading: r.ocrReading,
        workingValue: r.workingValue,
      };

      seenIndices.set(norm, newRow);
      allRows.push(newRow);
    }
  }

  if (allRows.length === 0) {
    const isScannedNoText = diag.pdfTextStats.every((s) => s.charCount === 0);
    const anyOcrCompleted = diag.ocrStats.some((s) => s.completed);
    const totalOcrWords = diag.ocrStats.reduce((acc, s) => acc + s.wordCount, 0);

    let reason = `No student records could be identified in "${file.name}".`;
    if (isScannedNoText && !anyOcrCompleted) {
      reason += ` The PDF contains no selectable text (scanned image / vector curves) and OCR could not run. (${ocrErrorStr || 'Local OCR worker or language model unavailable'})`;
    } else if (isScannedNoText && totalOcrWords === 0) {
      reason += ` The PDF contains no selectable text and OCR completed with 0 recognized words. Check page image resolution or contrast.`;
    } else if (isScannedNoText) {
      reason += ` The PDF has 0 text-layer characters. OCR scanned the page images and recognized ${totalOcrWords} words, but no student index numbers matched recognized university formats (e.g. ICT/yy/nnn).`;
    } else {
      reason += ` Please ensure the PDF is a valid university examination result sheet.`;
    }
    diag.summaryReason = reason;
    throw Object.assign(new Error(reason), { diagnostics: diag });
  }

  // Official printed total extraction & mismatch detection
  let printedTotal = extractResult.header.printedTotal ?? null;
  if (printedTotal === null && ocrResults.length > 0) {
    for (const pageOcr of ocrResults) {
      if (!pageOcr?.fullText) continue;
      const total = extractPrintedTotal(pageOcr.fullText);
      if (total !== null) {
        printedTotal = total;
        break;
      }
    }
  }

  diag.printedTotal = printedTotal;
  diag.extractedCount = allRows.length;

  const countMismatchWarning =
    printedTotal !== null && allRows.length !== printedTotal
      ? `Extracted ${allRows.length} students, but official PDF prints a total of ${printedTotal} students. Please review.`
      : null;

  diag.summaryReason = countMismatchWarning || `Successfully extracted ${allRows.length} student records.`;

  const sheet: MockSheet = {
    id: `sheet-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    fileName: file.name,
    displayName: `${courseCode}_${courseName.replace(/\s+/g, '_')}.pdf`,
    courseCode,
    courseName,
    academicYear,
    semesterNumber,
    examYear,
    examSession,
    type: 'original',
    rows: allRows,
    semesterWarning,
    academicYearWarning,
    printedTotal,
    countMismatchWarning,
  };

  return { sheet, diagnostics: diag };
}

