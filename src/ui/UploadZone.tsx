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
import { extractPdfPages, ensurePdfWorker, normaliseIndexNumber, validateIndexNumber, parseHeaderFromText, extractAcademicYear } from '../extract/pdfText';
import { extractTextLayerRows, reconcilePage, findRowColumns, reconstructRowItems, reconstructOcrWords } from '../extract/reconcile';
import { runOcrOnPages, groupOcrWordsIntoRows, type OcrPageResult, type OcrWord } from '../extract/ocr';
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
  const [diagnostics, setDiagnostics] = useState<ExtractionDiagnostics | null>(null);
  const [showDiagnosticsDetail, setShowDiagnosticsDetail] = useState(true);

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
    alert('Diagnostics copied to clipboard!');
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
    const seenIndices = new Set<string>();

    for (const page of extractResult.pages) {
      const textRows = extractTextLayerRows(page.rows);
      const pageOcr = ocrResults.find((o) => o.pageNumber === page.pageNumber);
      const ocrWords = pageOcr ? pageOcr.words : [];

      // Collect diagnostics for candidate rows
      if (page.rows.length > 0) {
        for (const rawRow of page.rows) {
          const sorted = reconstructRowItems(rawRow);
          const cols = findRowColumns(sorted);
          if (!cols) {
            diag.candidateRows.push({
              pageNumber: page.pageNumber,
              source: 'text',
              indexCandidate: undefined,
              gradeCandidate: undefined,
              accepted: false,
              rejectionReason: 'No student index number pattern recognized in row',
            });
          } else {
            const norm = normaliseIndexNumber(cols.indexItem.str);
            if (!norm) {
              diag.candidateRows.push({
                pageNumber: page.pageNumber,
                source: 'text',
                indexCandidate: cols.indexItem.str,
                gradeCandidate: cols.gradeItem?.str,
                accepted: false,
                rejectionReason: `Index number normalisation rejected: "${cols.indexItem.str}"`,
              });
            } else if (!validateIndexNumber(norm)) {
              diag.candidateRows.push({
                pageNumber: page.pageNumber,
                source: 'text',
                indexCandidate: norm,
                gradeCandidate: cols.gradeItem?.str,
                accepted: false,
                rejectionReason: `Index failed university validation pattern: "${norm}"`,
              });
            } else {
              diag.candidateRows.push({
                pageNumber: page.pageNumber,
                source: 'text',
                indexCandidate: norm,
                gradeCandidate: cols.gradeItem?.str,
                accepted: true,
              });
            }
          }
        }
      } else if (ocrWords.length > 0) {
        const ocrRows = groupOcrWordsIntoRows(ocrWords);
        for (const rawOcrRow of ocrRows) {
          const sorted = reconstructOcrWords(rawOcrRow);
          const hasIdx = sorted.some((w: OcrWord) => {
            const norm = normaliseIndexNumber(w.text);
            return norm !== null && validateIndexNumber(norm);
          });
          if (hasIdx) {
            diag.candidateRows.push({
              pageNumber: page.pageNumber,
              source: 'ocr',
              indexCandidate: sorted[0].text,
              accepted: true,
            });
          } else {
            diag.candidateRows.push({
              pageNumber: page.pageNumber,
              source: 'ocr',
              accepted: false,
              rejectionReason: 'No valid index number recognized in OCR line cluster',
            });
          }
        }
      }

      const reconciled = reconcilePage(textRows, ocrWords, textRows.length === 0, 2.0);

      for (const r of reconciled.rows) {
        if (!r.indexNumber) continue;
        const norm = r.indexNumber.toUpperCase().replace(/\s+/g, '');
        if (seenIndices.has(norm)) continue;
        seenIndices.add(norm);

        allRows.push({
          indexNumber: r.indexNumber,
          moduleCode: courseCode,
          grade: r.grade,
          status: r.status,
          flags: r.flags,
          textReading: r.textReading,
          ocrReading: r.ocrReading,
          workingValue: r.workingValue,
        });
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
    };
  };

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (arr.length === 0) return;

      setUploadError(null);
      setProcessingNames(arr.map((f) => f.name));
      setProgressPercent(10);
      abortControllerRef.current = new AbortController();

      try {
        for (let i = 0; i < arr.length; i++) {
          const file = arr[i];
          const sheet = await parseSinglePdf(file);
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

      {/* ── Extraction Diagnostics Panel (Dev Mode / Visible on failure) ── */}
      {diagnostics && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '1rem',
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            borderRadius: 'var(--r-md)',
            fontSize: '0.8125rem',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1rem' }}>🔍</span>
              <strong>Extraction Diagnostics ({diagnostics.fileName})</strong>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={copyDiagnosticsToClipboard}
                style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                title="Copy diagnostic report JSON"
              >
                📋 Copy Report
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <div style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Pages</span>
              <strong>{diagnostics.pageCount}</strong>
            </div>
            <div style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>Text Layer Chars</span>
              <strong>{diagnostics.pdfTextStats.reduce((sum, s) => sum + s.charCount, 0)}</strong>
              {diagnostics.pdfTextStats.every(s => s.charCount === 0) && (
                <span style={{ color: '#f59e0b', fontSize: '0.65rem', display: 'block' }}>(Scanned / Vector)</span>
              )}
            </div>
            <div style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>OCR Completed</span>
              <strong style={{ color: diagnostics.ocrStats.some(s => s.completed) ? '#10b981' : '#ef4444' }}>
                {diagnostics.ocrStats.some(s => s.completed) ? 'Yes' : 'No / Error'}
              </strong>
            </div>
            <div style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', display: 'block' }}>OCR Words</span>
              <strong>{diagnostics.ocrStats.reduce((sum, s) => sum + s.wordCount, 0)}</strong>
            </div>
          </div>

          {showDiagnosticsDetail && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ fontSize: '0.75rem' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Per-Page Summary:</span>
                <ul style={{ margin: '0.25rem 0 0.5rem 1rem', padding: 0 }}>
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

              {diagnostics.candidateRows.length > 0 && (
                <div style={{ fontSize: '0.75rem', maxHeight: '160px', overflowY: 'auto' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Candidate Rows Inspected:</span>
                  <table style={{ width: '100%', marginTop: '0.25rem', borderCollapse: 'collapse', fontSize: '0.7rem' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '0.2rem' }}>P#</th>
                        <th style={{ padding: '0.2rem' }}>Src</th>
                        <th style={{ padding: '0.2rem' }}>Candidate</th>
                        <th style={{ padding: '0.2rem' }}>Status</th>
                        <th style={{ padding: '0.2rem' }}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnostics.candidateRows.slice(0, 15).map((cr, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '0.2rem' }}>{cr.pageNumber}</td>
                          <td style={{ padding: '0.2rem' }}>{cr.source}</td>
                          <td style={{ padding: '0.2rem', fontFamily: 'monospace' }}>{cr.indexCandidate || '—'}</td>
                          <td style={{ padding: '0.2rem', color: cr.accepted ? '#10b981' : '#ef4444' }}>
                            {cr.accepted ? 'Accepted' : 'Rejected'}
                          </td>
                          <td style={{ padding: '0.2rem', color: 'var(--text-muted)' }}>{cr.rejectionReason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {diagnostics.candidateRows.length > 15 && (
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      (showing first 15 of {diagnostics.candidateRows.length} candidates)
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
