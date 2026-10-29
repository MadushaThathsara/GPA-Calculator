/**
 * App.tsx
 *
 * Root application component wiring together M4 (Upload / Sheets) and
 * M5 (Search / Results) UI.
 *
 * Layout:
 *  ┌─────────────────────────────────────────┐
 *  │  SiteHeader (sticky)                    │
 *  ├──────────────┬──────────────────────────┤
 *  │  Left panel  │  Right panel             │
 *  │  · Upload    │  · Search bar (w/ chips) │
 *  │  · Sheets    │  · Student results       │
 *  │    list      │    (per-semester table)  │
 *  └──────────────┴──────────────────────────┘
 *
 * State is managed by useSessionStore (spec §7, §14, §15 M4/M5).
 * University config is UoC provisional (spec §12 — to be verified).
 */

import { useState, useEffect, type FC } from 'react';
import SiteHeader from './ui/SiteHeader';
import UploadZone from './ui/UploadZone';
import SheetsList from './ui/SheetsList';
import SearchBar from './ui/SearchBar';
import StudentResults from './ui/StudentResults';
import DuplicateCourseModal from './ui/DuplicateCourseModal';
import { useSessionStore } from './store/useSessionStore';
import type { MockSheet } from './store/useSessionStore';
import uocConfig from './rules/universities/uoc';

interface PendingDuplicate {
  existing: MockSheet;
  incoming: MockSheet;
}

const App: FC = () => {
  const {
    sheets,
    moduleExclusions,
    toggleModule,
    addSheet,
    replaceSheet,
    removeSheet,
    clearSession,
    checkDuplicate,
    setManualCredit,
    toggleModuleExclusion,
    updateExamSession,
    updateAcademicYear,
    availableIndexNumbers,
    searchStudent,
  } = useSessionStore(uocConfig);

  const [searchResult, setSearchResult] = useState<ReturnType<typeof searchStudent>>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [pendingDuplicate, setPendingDuplicate] = useState<PendingDuplicate | null>(null);

  // Re-run search whenever sheets, exclusions, or query changes
  useEffect(() => {
    if (!searchQuery) {
      setSearchResult(null);
      setNotFound(false);
      return;
    }
    const res = searchStudent(searchQuery);
    setSearchResult(res);
    setNotFound(res === null && sheets.length > 0);
  }, [sheets, searchQuery, searchStudent]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (!query) {
      setSearchResult(null);
      setNotFound(false);
      return;
    }
    const result = searchStudent(query);
    setSearchResult(result);
    setNotFound(result === null && sheets.length > 0);
  };

  /** Check for duplicate before adding (spec §3 flow 2, M4) */
  const handleSheetParsed = (sheet: MockSheet) => {
    const existing = checkDuplicate(sheet.courseCode, sheet.type ?? 'original');

    if (existing) {
      // If user clicked the same sample button again, don't duplicate
      if (existing.fileName === sheet.fileName && existing.rows.length === sheet.rows.length) {
        return;
      }
      setPendingDuplicate({ existing, incoming: sheet });
    } else {
      addSheet(sheet);
    }
  };

  const handleResolveReplace = () => {
    if (pendingDuplicate) {
      replaceSheet(pendingDuplicate.existing.id, pendingDuplicate.incoming);
      setPendingDuplicate(null);
    }
  };

  const handleResolveKeepRepeatResit = () => {
    if (pendingDuplicate) {
      addSheet(pendingDuplicate.incoming, true);
      setPendingDuplicate(null);
    }
  };

  const handleCancelDuplicate = () => {
    setPendingDuplicate(null);
  };

  const handleSetManualCredit = (moduleCode: string, credits: number) => {
    setManualCredit(moduleCode, credits);
  };

  const handleToggleExclude = (indexNumber: string, moduleCode: string) => {
    toggleModuleExclusion(indexNumber, moduleCode);
  };

  const hasSheets = sheets.length > 0;
  const indices = availableIndexNumbers();

  return (
    <>
      <SiteHeader sheetCount={sheets.length} />

      <main className="app-main" id="main-content">
        <div className="container">

          {/* ── Duplicate Course Modal (M4) ── */}
          {pendingDuplicate && (
            <DuplicateCourseModal
              existingSheet={pendingDuplicate.existing}
              newSheet={pendingDuplicate.incoming}
              onReplace={handleResolveReplace}
              onKeepRepeatResit={handleResolveKeepRepeatResit}
              onCancel={handleCancelDuplicate}
            />
          )}

          {/* ── Provisional warning ── */}
          <div className="provisional-banner" role="status" aria-live="polite">
            <span aria-hidden="true">⚠️</span>
            <span>
              <strong>Provisional university rules:</strong> Grade scale, classification thresholds, and
              repeat-cap rules are currently provisional. Confirm against your faculty's official grading document.
            </span>
          </div>

          {/* ── Two-column layout ── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'clamp(300px, 35%, 420px) 1fr',
              gap: '1.75rem',
              alignItems: 'start',
            }}
          >
            {/* ══ LEFT: Upload & Sheets panel ══ */}
            <aside aria-label="Upload and manage result sheets">
              <div className="card animate-in">
                <div className="card__header" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <div className="card__icon card__icon--indigo" aria-hidden="true">📄</div>
                    <div>
                      <p className="card__title">Result Sheets</p>
                      <p className="card__subtitle">Drag &amp; drop or tap to select</p>
                    </div>
                  </div>

                  {hasSheets && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={clearSession}
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', color: 'var(--danger)' }}
                      title="Clear all uploaded sheets in this browser session"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                <UploadZone onSheetParsed={handleSheetParsed} />

                <SheetsList
                  sheets={sheets}
                  moduleExclusions={moduleExclusions}
                  onToggleModule={toggleModule}
                  onRemove={removeSheet}
                  onClearAll={clearSession}
                  onUpdateSession={updateExamSession}
                  onUpdateAcademicYear={updateAcademicYear}
                />
              </div>

              {/* ── How it works ── */}
              {!hasSheets && (
                <div className="card animate-in animate-in--delay-1" style={{ marginTop: '1rem' }}>
                  <div className="card__header">
                    <div className="card__icon card__icon--violet" aria-hidden="true">💡</div>
                    <p className="card__title">How It Works</p>
                  </div>
                  <ol
                    style={{
                      paddingLeft: '1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.625rem',
                      color: 'var(--text-secondary)',
                      fontSize: '0.875rem',
                      lineHeight: 1.6,
                    }}
                  >
                    <li>Drop one or more result-sheet PDFs or click the quick sample loader.</li>
                    <li>The browser extracts index numbers, grades, and statuses client-side.</li>
                    <li>Type an index number (e.g. <code>811</code>) to view semester SGPA, CGPA, and degree class.</li>
                    <li>
                      <span className="flag flag--check" style={{ fontSize: '0.7rem' }}>⚠️ Check this</span>{' '}
                      identifies cells where the PDF text layer and OCR disagree (OCR wins).
                    </li>
                  </ol>
                </div>
              )}

              {/* ── Privacy note ── */}
              <div
                className="animate-in animate-in--delay-2"
                style={{
                  marginTop: '1rem',
                  padding: '0.875rem 1rem',
                  background: 'rgba(52,211,153,0.06)',
                  border: '1px solid rgba(52,211,153,0.18)',
                  borderRadius: 'var(--r-md)',
                  display: 'flex',
                  gap: '0.625rem',
                  alignItems: 'flex-start',
                  fontSize: '0.8125rem',
                  color: 'var(--success)',
                }}
              >
                <span aria-hidden="true" style={{ flexShrink: 0, marginTop: '0.05rem' }}>🔒</span>
                <span>
                  <strong>100% Client-Side.</strong> All calculations and PDF parsing run entirely inside your browser tab.
                  No server, no database, no data uploaded.
                </span>
              </div>
            </aside>

            {/* ══ RIGHT: Search + Results panel ══ */}
            <section aria-label="Student search and results">

              {/* Search card */}
              <div className="card animate-in animate-in--delay-1">
                <div className="card__header">
                  <div className="card__icon card__icon--indigo" aria-hidden="true">🔎</div>
                  <div>
                    <p className="card__title">Student Index Lookup</p>
                    <p className="card__subtitle">Search across all loaded semesters in this session</p>
                  </div>
                </div>

                <SearchBar
                  onSearch={handleSearch}
                  disabled={!hasSheets}
                  availableIndices={indices}
                />

                {!hasSheets && (
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                    Upload a result sheet or click "Load Sample Sheets" on the left to start.
                  </p>
                )}
              </div>

              {/* ── Results area ── */}
              <div style={{ marginTop: '1.5rem' }}>

                {/* Not found */}
                {notFound && (
                  <div className="empty-state animate-in">
                    <div className="empty-state__icon">🔍</div>
                    <p className="empty-state__title">No matching student found</p>
                    <p className="empty-state__sub">
                      "{searchQuery}" does not match any index number in the loaded sheets.<br />
                      Try clicking one of the student chips above.
                    </p>
                  </div>
                )}

                {/* Student results */}
                {searchResult && (
                  <StudentResults
                    result={searchResult}
                    moduleExclusions={moduleExclusions}
                    onSetManualCredit={handleSetManualCredit}
                    onToggleExclude={handleToggleExclude}
                    onToggleModule={toggleModule}
                  />
                )}

                {/* Empty state — sheets loaded, awaiting search */}
                {!searchResult && !notFound && hasSheets && (
                  <div className="empty-state animate-in">
                    <div className="empty-state__icon">🎓</div>
                    <p className="empty-state__title">Select or enter an index number</p>
                    <p className="empty-state__sub">
                      Click any student chip above or type an index number to display semester results, SGPA, CGPA, and degree classification.
                    </p>
                  </div>
                )}

                {/* Empty state — no sheets at all */}
                {!hasSheets && (
                  <div className="empty-state animate-in">
                    <div className="empty-state__icon">📂</div>
                    <p className="empty-state__title">No result sheets loaded yet</p>
                    <p className="empty-state__sub">
                      Drop university PDF result sheets or click "+ Load 2 Semesters" to see the live interface in action.
                    </p>
                  </div>
                )}
              </div>

            </section>
          </div>

        </div>
      </main>

      {/* ── Footer ── */}
      <footer
        style={{
          padding: '1.25rem',
          borderTop: '1px solid var(--border)',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}
        role="contentinfo"
      >
        GPA Calculator &amp; Academic Performance Tracker — client-side static application.
        All grading scales and classifications are provisional until verified against official university documents.
      </footer>
    </>
  );
};

export default App;
