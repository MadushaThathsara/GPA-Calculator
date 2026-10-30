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
import type { MockSheet } from '../store/useSessionStore';
import { ALL_SAMPLE_SHEETS, SAMPLE_SHEET_1, SAMPLE_SHEET_2 } from '../store/sampleSheets';
import { parsePdfFile, type ExtractionDiagnostics } from '../extract/parsePdf';

export type { ExtractionDiagnostics };

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

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const allFiles = Array.from(files);
      if (allFiles.length === 0) return;

      const pdfFiles = allFiles.filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      const nonPdfFiles = allFiles.filter((f) => !pdfFiles.includes(f));

      if (pdfFiles.length === 0) {
        setUploadError(
          `Only PDF result-sheet files are supported. Skipped ${nonPdfFiles.length} unsupported file(s): ${nonPdfFiles.map((f) => f.name).join(', ')}.`,
        );
        return;
      }

      setUploadError(null);
      setUploadWarning(null);
      setProcessingNames(pdfFiles.map((f) => f.name));
      setProgressPercent(5);
      abortControllerRef.current = new AbortController();

      const failedFiles: Array<{ name: string; reason: string }> = [];
      const successfulSheets: MockSheet[] = [];

      for (let i = 0; i < pdfFiles.length; i++) {
        if (abortControllerRef.current?.signal.aborted) break;
        const file = pdfFiles[i];
        setStatusMessage(`Processing file ${i + 1} of ${pdfFiles.length}: ${file.name}…`);

        try {
          const { sheet, diagnostics: diag } = await parsePdfFile(file, {
            onStatus: (msg) => setStatusMessage(`[${i + 1}/${pdfFiles.length}] ${msg}`),
            onProgress: (pct) => {
              const fileShare = 100 / pdfFiles.length;
              const overall = Math.round(i * fileShare + (pct / 100) * fileShare);
              setProgressPercent(overall);
            },
            signal: abortControllerRef.current?.signal,
          });

          setDiagnostics(diag);
          successfulSheets.push(sheet);
          if (sheet.countMismatchWarning) {
            setUploadWarning(sheet.countMismatchWarning);
          }
          onSheetParsed(sheet);
        } catch (err: unknown) {
          if ((err as Error)?.name === 'AbortError' || (err as Error)?.message?.includes('cancelled')) {
            setUploadError('Upload cancelled by user.');
            break;
          }
          const diag = (err as any)?.diagnostics;
          if (diag) setDiagnostics(diag);
          const reason = (err as Error)?.message || 'Extraction failed';
          failedFiles.push({ name: file.name, reason });
          console.warn(`Extraction error for ${file.name}:`, err);
        }
      }

      setProgressPercent(100);

      // Report any errors or warnings without breaking valid uploads
      if (failedFiles.length > 0) {
        if (successfulSheets.length === 0) {
          setUploadError(failedFiles.map((f) => `"${f.name}": ${f.reason}`).join('; '));
        } else {
          setUploadWarning(
            `Extracted ${successfulSheets.length} file(s) successfully. ${failedFiles.length} file(s) could not be processed: ${failedFiles.map((f) => `"${f.name}" (${f.reason})`).join(', ')}.`,
          );
        }
      } else if (nonPdfFiles.length > 0) {
        setUploadWarning(
          `Extracted ${successfulSheets.length} file(s). Skipped ${nonPdfFiles.length} non-PDF file(s): ${nonPdfFiles.map((f) => f.name).join(', ')}.`,
        );
      }

      setTimeout(() => {
        setProcessingNames([]);
        setProgressPercent(0);
        setStatusMessage('');
        abortControllerRef.current = null;
      }, 500);
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
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!isProcessing) inputRef.current?.click();
          }
        }}
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
