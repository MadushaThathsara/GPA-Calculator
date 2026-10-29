/**
 * ui/UploadZone.tsx
 *
 * M4 — Drag-and-drop / tap-to-select PDF upload component.
 *
 * Spec §3 Core flow 1: "The user drops PDFs. The browser extracts and
 * displays results immediately, with no mandatory review."
 * Spec §2: "Upload one or many PDFs: drag-and-drop on desktop, tap-to-select on mobile."
 * Spec §15 M4: Display file name renamed from content: <CourseCode>_<CourseName>.pdf.
 * Spec §5: Full OCR pipeline comparison with text layer.
 */

import { useState, useRef, useCallback, type DragEvent, type ChangeEvent, type FC } from 'react';
import type { MockSheet, MockResultRow } from '../store/useSessionStore';
import { extractPdfPages, ensurePdfWorker, normaliseIndexNumber, parseHeaderFromText, extractAcademicYear, extractPrintedTotal } from '../extract/pdfText';
import { extractTextLayerRows, reconcilePage, isSummaryOrFooterRow } from '../extract/reconcile';
import { runOcrOnPages, type OcrPageResult } from '../extract/ocr';
import { ALL_SAMPLE_SHEETS, SAMPLE_SHEET_1, SAMPLE_SHEET_2 } from '../store/sampleSheets';

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

interface UploadZoneProps {
  onSheetParsed: (sheet: MockSheet) => void;
  onDuplicateCheck?: (courseCode: string) => MockSheet | undefined;
}

const UploadZone: FC<UploadZoneProps> = ({ onSheetParsed }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [processingNames, setProcessingNames] = useState<string[]>([]);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ExtractionDiagnostics | null>(null);
  const [showDiagnosticsDetail, setShowDiagnosticsDetail] = useState(true);
  const [diagFilter, setDiagFilter] = useState<'all' | 'accepted' | 'rejected'>('all');
  const [diagSearch, setDiagSearch] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelUpload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setProcessingNames([]);
    setProgressPercent(0);
    setStatusMessage('');
    setUploadError('PDF extraction was cancelled.');
  };

  const copyDiagnosticsToClipboard = () => {
    if (!diagnostics) return;
    const json = JSON.stringify(diagnostics, null, 2);
    navigator.clipboard.writeText(json);
    alert('Diagnostics copied to clipboard as JSON!');
  };

  const copyDiagnosticsCsv = () => {
    if (!diagnostics) return;
    const header = ['Page', 'Source', 'Candidate', 'Grade', 'Status', 'Rejection Reason'];
    const rows = diagnostics.candidateRows.map((r) => [
      r.pageNumber,
      r.source,
      `"${(r.indexCandidate || '').replace(/"/g, '""')}"`,
      `"${(r.gradeCandidate || '').replace(/"/g, '""')}"`,
      r.accepted ? 'Accepted' : 'Rejected',
      `"${(r.rejectionReason || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    navigator.clipboard.writeText(csvContent);
    alert('Candidate rows copied to clipboard as CSV!');
  };

  const parseSinglePdf = async (file: File): Promise<MockSheet> => {
    setStatusMessage(`Loading ${file.name}…`);
    setDiagnostics(null);
    await ensurePdfWorker();
    const buffer = await file.arrayBuffer();

    // Step 1: Render each PDF page to canvas and extract text items
    setStatusMessage(`Rendering pages for ${file.name}…`);
    const extractResult = await extractPdfPages(buffer, 2.0, (current, total) => {
      setProgressPercent(Math.round((current / total) * 35));
    });

    if (!extractResult.pages || extractResult.pages.length === 0) {
      throw new Error(`The file "${file.name}" contains no renderable PDF pages.`);
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
    setStatusMessage(`Scanning page images with OCR…`);
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
            setProgressPercent(ocrPct);
            setStatusMessage(`OCR scanning page ${evt.currentPage} of ${evt.totalPages}…`);
          },
          signal: abortControllerRef.current?.signal,
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

    // Requirement 1: Derive academic year from the module code
    // Normalize module code by removing spaces before processing; do not use module code to determine semester!
    const academicYear = extractAcademicYear(courseCode);

    const semesterWarning = !examSession
      ? 'Examination semester heading could not be identified from the PDF. Please assign the semester manually.'
      : null;

    const academicYearWarning = courseCode && academicYear === null
      ? `Academic year could not be determined from module code "${courseCode}".`
      : null;

    // Step 3: Reconcile text-layer with OCR for every page
    setStatusMessage(`Reconciling text & OCR readings…`);
    setProgressPercent(95);

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
      setDiagnostics(diag);
      throw new Error(reason);
    }

    // Official printed total extraction & mismatch detection (Requirements 7 & 8)
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
    setDiagnostics(diag);

    return {
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
  };

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (arr.length === 0) return;

      setUploadError(null);
      setUploadWarning(null);
      setProcessingNames(arr.map((f) => f.name));
      setProgressPercent(10);
      abortControllerRef.current = new AbortController();

      try {
        for (let i = 0; i < arr.length; i++) {
          const file = arr[i];
          const sheet = await parseSinglePdf(file);
          if (sheet.countMismatchWarning) {
            setUploadWarning(sheet.countMismatchWarning);
          }
          onSheetParsed(sheet);
        }
        setProgressPercent(100);
      } catch (err: unknown) {
        const msg = (err as Error)?.message || 'Failed to extract PDF result sheets.';
        setUploadError(msg);
      } finally {
        setTimeout(() => {
          setProcessingNames([]);
          setProgressPercent(0);
          setStatusMessage('');
          abortControllerRef.current = null;
        }, 500);
      }
    },
    [onSheetParsed],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles],
  );

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const onDragLeave = () => setIsDragOver(false);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = '';
  };

  const loadSampleSheets = (e: React.MouseEvent) => {
    e.stopPropagation();
    setUploadError(null);
    for (const sheet of ALL_SAMPLE_SHEETS) {
      onSheetParsed(sheet);
    }
  };

  const loadInitialSample = (e: React.MouseEvent) => {
    e.stopPropagation();
    setUploadError(null);
    onSheetParsed(SAMPLE_SHEET_1);
    onSheetParsed(SAMPLE_SHEET_2);
  };

  const isProcessing = processingNames.length > 0;

  return (
    <div>
      {/* ── Error Banner ── */}
      {uploadError && (
        <div
          role="alert"
          style={{
            marginBottom: '0.875rem',
            padding: '0.75rem 1rem',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 'var(--r-md)',
            color: '#fca5a5',
            fontSize: '0.8125rem',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <span aria-hidden="true" style={{ fontSize: '1rem' }}>⚠️</span>
            <div>
              <strong>Extraction Error:</strong> {uploadError}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setUploadError(null);
              setDiagnostics(null);
            }}
            style={{
              background: 'none',
              border: 'none',
              color: '#fca5a5',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '1rem',
              lineHeight: 1,
            }}
            title="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Warning Banner (e.g. Student Count Mismatch) ── */}
      {uploadWarning && !uploadError && (
        <div
          role="alert"
          style={{
            marginBottom: '0.875rem',
            padding: '0.75rem 1rem',
            background: 'rgba(245, 158, 11, 0.12)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            borderRadius: 'var(--r-md)',
            color: '#fcd34d',
            fontSize: '0.8125rem',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
            <span aria-hidden="true" style={{ fontSize: '1rem' }}>⚠️</span>
            <div>
              <strong>Extraction Warning:</strong> {uploadWarning}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setUploadWarning(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#fcd34d',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '1rem',
              lineHeight: 1,
            }}
            title="Dismiss warning"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Extraction Diagnostics Panel (Dev Mode / Visible on upload & failure) ── */}
      {diagnostics && (() => {
        const candidateRows = diagnostics.candidateRows ?? [];
        const acceptedCount = candidateRows.filter((r) => r.accepted).length;
        const rejectedCount = candidateRows.filter((r) => !r.accepted).length;
        const filteredCandidates = candidateRows.filter((cr) => {
          if (diagFilter === 'accepted' && !cr.accepted) return false;
          if (diagFilter === 'rejected' && cr.accepted) return false;
          if (diagSearch.trim()) {
            const q = diagSearch.toLowerCase().trim();
            const matchIdx = (cr.indexCandidate || '').toLowerCase().includes(q);
            const matchReason = (cr.rejectionReason || '').toLowerCase().includes(q);
            const matchGrade = (cr.gradeCandidate || '').toLowerCase().includes(q);
            return matchIdx || matchReason || matchGrade;
          }
          return true;
        });

        return (
          <div
            style={{
              marginBottom: '1rem',
              padding: '1rem',
              background: 'rgba(30, 41, 59, 0.75)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              borderRadius: 'var(--r-md)',
              fontSize: '0.8125rem',
              color: 'var(--text-primary)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>🔍</span>
                <strong>Extraction Diagnostics ({diagnostics.fileName})</strong>
              </div>
              <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={copyDiagnosticsCsv}
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                  title="Copy candidate rows as CSV"
                >
                  📋 Copy CSV
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={copyDiagnosticsToClipboard}
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                  title="Copy full diagnostic report JSON"
                >
                  📋 Copy JSON
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setShowDiagnosticsDetail(!showDiagnosticsDetail)}
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                >
                  {showDiagnosticsDetail ? 'Hide Details' : 'Show Details'}
                </button>
              </div>
            </div>

            {/* Metric summaries */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Pages</span>
                <strong>{diagnostics.pageCount}</strong>
              </div>
              <div style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Text Layer Chars</span>
                <strong>{diagnostics.pdfTextStats.reduce((sum, s) => sum + s.charCount, 0)}</strong>
                {diagnostics.pdfTextStats.every((s) => s.charCount === 0) && (
                  <span style={{ color: '#f59e0b', fontSize: '0.65rem', display: 'block' }}>(Scanned / Vector)</span>
                )}
              </div>
              <div style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>OCR Status</span>
                <strong style={{ color: diagnostics.ocrStats.some((s) => s.completed) ? '#10b981' : '#ef4444' }}>
                  {diagnostics.ocrStats.some((s) => s.completed) ? 'Completed' : 'Failed / N/A'}
                </strong>
              </div>
              <div style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Extracted Count</span>
                <strong style={{ color: '#38bdf8' }}>{diagnostics.extractedCount ?? '—'}</strong>
              </div>
              {diagnostics.printedTotal !== undefined && diagnostics.printedTotal !== null && (
                <div style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Official Printed Total</span>
                  <strong style={{ color: diagnostics.extractedCount === diagnostics.printedTotal ? '#10b981' : '#f59e0b' }}>
                    {diagnostics.printedTotal} {diagnostics.extractedCount === diagnostics.printedTotal ? '✓' : '⚠️'}
                  </strong>
                </div>
              )}
            </div>

            {showDiagnosticsDetail && (
              <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Per-Page Details:</span>
                  <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                    {diagnostics.pdfTextStats.map((ts, idx) => {
                      const os = diagnostics.ocrStats[idx];
                      return (
                        <li key={ts.pageNumber} style={{ marginTop: '0.25rem' }}>
                          Page {ts.pageNumber}: PDF.js Text = {ts.charCount} chars ({ts.itemCount} items) | OCR = {os?.completed ? `${os.wordCount} words (${os.charCount} chars)` : `Failed: ${os?.error || 'Incomplete'}`}
                          {os?.sampleText && (
                            <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.7rem', marginLeft: '0.5rem' }}>
                              Sample: "{os.sampleText}…"
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {candidateRows.length > 0 && (
                  <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.375rem' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Candidate Records Inspected ({candidateRows.length}):
                      </span>
                      {/* Filter Pills */}
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button
                          type="button"
                          onClick={() => setDiagFilter('all')}
                          style={{
                            padding: '0.15rem 0.5rem',
                            fontSize: '0.7rem',
                            borderRadius: '999px',
                            border: '1px solid var(--border)',
                            background: diagFilter === 'all' ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
                            color: diagFilter === 'all' ? '#60a5fa' : 'var(--text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          All ({candidateRows.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setDiagFilter('accepted')}
                          style={{
                            padding: '0.15rem 0.5rem',
                            fontSize: '0.7rem',
                            borderRadius: '999px',
                            border: '1px solid var(--border)',
                            background: diagFilter === 'accepted' ? 'rgba(16, 185, 129, 0.25)' : 'transparent',
                            color: diagFilter === 'accepted' ? '#34d399' : 'var(--text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          Accepted ({acceptedCount})
                        </button>
                        <button
                          type="button"
                          onClick={() => setDiagFilter('rejected')}
                          style={{
                            padding: '0.15rem 0.5rem',
                            fontSize: '0.7rem',
                            borderRadius: '999px',
                            border: '1px solid var(--border)',
                            background: diagFilter === 'rejected' ? 'rgba(239, 68, 68, 0.25)' : 'transparent',
                            color: diagFilter === 'rejected' ? '#f87171' : 'var(--text-muted)',
                            cursor: 'pointer',
                          }}
                        >
                          Rejected ({rejectedCount})
                        </button>
                      </div>
                    </div>

                    {/* Search filter input */}
                    <div style={{ marginBottom: '0.5rem' }}>
                      <input
                        type="text"
                        value={diagSearch}
                        onChange={(e) => setDiagSearch(e.target.value)}
                        placeholder="🔍 Filter candidates by index or rejection reason…"
                        style={{
                          width: '100%',
                          padding: '0.25rem 0.5rem',
                          fontSize: '0.7rem',
                          background: 'rgba(0, 0, 0, 0.25)',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>

                    {/* Scrollable Candidates Table */}
                    <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#1e293b', borderBottom: '1px solid var(--border)' }}>
                          <tr style={{ textAlign: 'left' }}>
                            <th style={{ padding: '0.25rem 0.4rem', width: '32px' }}>#</th>
                            <th style={{ padding: '0.25rem 0.4rem', width: '36px' }}>P#</th>
                            <th style={{ padding: '0.25rem 0.4rem', width: '48px' }}>Src</th>
                            <th style={{ padding: '0.25rem 0.4rem' }}>Candidate Index</th>
                            <th style={{ padding: '0.25rem 0.4rem', width: '56px' }}>Grade</th>
                            <th style={{ padding: '0.25rem 0.4rem', width: '70px' }}>Status</th>
                            <th style={{ padding: '0.25rem 0.4rem' }}>Reason / Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCandidates.length === 0 ? (
                            <tr>
                              <td colSpan={7} style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                No candidates match the current filter or search query.
                              </td>
                            </tr>
                          ) : (
                            filteredCandidates.map((cr, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <td style={{ padding: '0.25rem 0.4rem', color: 'var(--text-muted)' }}>{i + 1}</td>
                                <td style={{ padding: '0.25rem 0.4rem' }}>{cr.pageNumber}</td>
                                <td style={{ padding: '0.25rem 0.4rem' }}>
                                  <span
                                    style={{
                                      padding: '0.1rem 0.3rem',
                                      borderRadius: '3px',
                                      fontSize: '0.65rem',
                                      background: cr.source === 'text' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(168, 85, 247, 0.2)',
                                      color: cr.source === 'text' ? '#60a5fa' : '#c084fc',
                                    }}
                                  >
                                    {cr.source === 'text' ? 'Text' : 'OCR'}
                                  </span>
                                </td>
                                <td style={{ padding: '0.25rem 0.4rem', fontFamily: 'monospace', fontWeight: 600 }}>
                                  {cr.indexCandidate || '—'}
                                </td>
                                <td style={{ padding: '0.25rem 0.4rem' }}>{cr.gradeCandidate || '—'}</td>
                                <td style={{ padding: '0.25rem 0.4rem' }}>
                                  <span
                                    style={{
                                      padding: '0.1rem 0.35rem',
                                      borderRadius: '3px',
                                      fontSize: '0.65rem',
                                      fontWeight: 600,
                                      background: cr.accepted ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                      color: cr.accepted ? '#34d399' : '#f87171',
                                    }}
                                  >
                                    {cr.accepted ? 'Accepted' : 'Rejected'}
                                  </span>
                                </td>
                                <td style={{ padding: '0.25rem 0.4rem', color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                                  {cr.rejectionReason || 'Valid candidate record'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.25rem', textAlign: 'right' }}>
                      Showing {filteredCandidates.length} of {candidateRows.length} candidates
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Drop Zone ── */}
      <div
        className={`upload-zone${isDragOver ? ' upload-zone--drag-over' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => !isProcessing && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload result-sheet PDFs"
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="upload-zone__input"
          onChange={onInputChange}
          aria-hidden="true"
          tabIndex={-1}
          id="pdf-upload-input"
        />

        {isProcessing ? (
          <div>
            <span className="upload-zone__icon" style={{ animation: 'spin 2s linear infinite', filter: 'none' }}>
              ⚙️
            </span>
            <p className="upload-zone__heading">Extracting PDF Results…</p>
            {processingNames.map((name) => (
              <p key={name} className="upload-zone__sub" style={{ marginTop: '0.25rem' }}>
                {name}
              </p>
            ))}

            {statusMessage && (
              <p style={{ fontSize: '0.75rem', color: 'var(--accent-1)', marginTop: '0.5rem' }}>
                {statusMessage}
              </p>
            )}

            <div
              className="progress-bar-track"
              style={{ marginTop: '1rem', maxWidth: '240px', margin: '1rem auto 0' }}
            >
              <div
                className="progress-bar-fill"
                style={{ width: `${progressPercent}%`, transition: 'width 0.3s ease' }}
              />
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={cancelUpload}
                style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', color: 'var(--text-muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <span className="upload-zone__icon">📄</span>
            <p className="upload-zone__heading">Drop result-sheet PDFs here</p>
            <p className="upload-zone__sub">or click to browse from your device</p>
            <p className="upload-zone__hint">
              Runs client-side OCR &amp; text reconciliation · Supports scanned and text PDFs
            </p>
          </div>
        )}
      </div>

      {/* Quick sample loader buttons */}
      <div
        style={{
          marginTop: '0.875rem',
          padding: '0.75rem',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            ⚡ Quick Test / Spec Fixtures:
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={loadInitialSample}
            style={{ fontSize: '0.75rem', flex: 1 }}
            title="Load Sem 1 & Sem 2 sample sheets"
          >
            + Load 2 Semesters
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={loadSampleSheets}
            style={{ fontSize: '0.75rem', flex: 1 }}
            title="Load 2 Semesters + 1 Repeat/Resit sheet"
          >
            + Load All (Inc. Resit)
          </button>
        </div>
      </div>
    </div>
  );
};

export default UploadZone;
