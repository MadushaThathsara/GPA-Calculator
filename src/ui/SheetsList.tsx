/**
 * ui/SheetsList.tsx
 *
 * M8 — Displays the list of uploaded result-sheet PDFs and session management.
 * Displays:
 *  - Extracted course code and course name as filename (<CourseCode>_<CourseName>.pdf).
 *  - Extracted student record count.
 *  - Processing status: Needs Review ⚠️ | Verified ✓ | Extracted.
 *  - Extraction warning status and toggleable warning viewer.
 *  - Individual file management: Replace (🔄) and Remove (✕).
 *  - Clear All session data action.
 */

import { useState, useRef, type ChangeEvent, type FC } from 'react';
import type { MockSheet } from '../store/useSessionStore';
import { calculateCourseSummary, normalizeModuleCode } from '../store/useSessionStore';

interface SheetsListProps {
  sheets: MockSheet[];
  moduleExclusions?: Record<string, boolean>;
  onToggleModule?: (moduleCode: string) => void;
  manualCredits?: Record<string, number>;
  onRemove: (id: string) => void;
  onClearAll?: () => void;
  onUpdateSession?: (id: string, newSession: string) => void;
  onUpdateAcademicYear?: (id: string, newYear: number | null) => void;
  onReplaceSheet?: (sheetId: string, file: File) => Promise<void> | void;
}

const SheetsList: FC<SheetsListProps> = ({
  sheets,
  moduleExclusions,
  onToggleModule,
  manualCredits,
  onRemove,
  onClearAll,
  onUpdateSession,
  onUpdateAcademicYear,
  onReplaceSheet,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempSession, setTempSession] = useState('');
  const [editingYearId, setEditingYearId] = useState<string | null>(null);
  const [tempYear, setTempYear] = useState<string>('');
  const [expandedWarnings, setExpandedWarnings] = useState<Record<string, boolean>>({});
  const [replacingTargetId, setReplacingTargetId] = useState<string | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);

  const replaceInputRef = useRef<HTMLInputElement>(null);

  if (sheets.length === 0) return null;

  const { totalCourseCredits, totalModules } = calculateCourseSummary(sheets, manualCredits);

  const startEdit = (sheet: MockSheet) => {
    setEditingId(sheet.id);
    setTempSession(sheet.examSession ?? '');
  };

  const saveEdit = (id: string) => {
    onUpdateSession?.(id, tempSession);
    setEditingId(null);
  };

  const startEditYear = (sheet: MockSheet) => {
    setEditingYearId(sheet.id);
    setTempYear(sheet.academicYear ? String(sheet.academicYear) : '');
  };

  const saveEditYear = (id: string) => {
    const parsed = parseInt(tempYear, 10);
    onUpdateAcademicYear?.(id, !isNaN(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null);
    setEditingYearId(null);
  };

  const toggleWarningDetails = (id: string) => {
    setExpandedWarnings((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleReplaceClick = (sheetId: string) => {
    setReplacingTargetId(sheetId);
    if (replaceInputRef.current) {
      replaceInputRef.current.value = '';
      replaceInputRef.current.click();
    }
  };

  const handleReplaceFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !replacingTargetId) return;

    setIsReplacing(true);
    try {
      await onReplaceSheet?.(replacingTargetId, file);
    } finally {
      setIsReplacing(false);
      setReplacingTargetId(null);
      if (replaceInputRef.current) {
        replaceInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="sheets-list">
      {/* Hidden file input for individual sheet replacement */}
      <input
        ref={replaceInputRef}
        type="file"
        accept=".pdf,application/pdf"
        style={{ display: 'none' }}
        onChange={handleReplaceFileChange}
        aria-label="Select replacement PDF"
      />

      {/* ── Course Summary (Total Course Credits & Total Modules only) ── */}
      <div className="course-summary-card" aria-label="Course Summary">
        <div className="course-summary-item">
          <div className="course-summary-value">{totalCourseCredits}</div>
          <div className="course-summary-label">Total Course Credits</div>
        </div>
        <div className="course-summary-divider" aria-hidden="true" />
        <div className="course-summary-item">
          <div className="course-summary-value">{totalModules}</div>
          <div className="course-summary-label">Total Modules</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <p className="section-label" style={{ margin: 0 }}>Uploaded Files ({sheets.length})</p>
        {onClearAll && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClearAll}
            style={{
              fontSize: '0.75rem',
              padding: '0.2rem 0.55rem',
              color: 'var(--danger)',
              border: '1px solid rgba(248,113,113,0.35)',
              background: 'rgba(248,113,113,0.08)',
              borderRadius: 'var(--r-sm)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            title="Remove all loaded result sheets"
          >
            🗑️ Clear All
          </button>
        )}
      </div>

      {sheets.map((sheet) => {
        const isEditing = editingId === sheet.id;
        const isResit = sheet.type === 'repeat-resit';
        const hasSession = !!sheet.examSession;
        const normCode = normalizeModuleCode(sheet.courseCode);
        const isExcluded = !!moduleExclusions?.[normCode] || !!moduleExclusions?.[sheet.courseCode.toUpperCase()];

        // Display filename: ALWAYS use extracted course code and name when available
        const fileDisplayName = sheet.courseCode
          ? `${sheet.courseCode}${sheet.courseName ? '_' + sheet.courseName.replace(/\s+/g, '_') : ''}.pdf`
          : (sheet.displayName || sheet.fileName);

        // Compile all extraction warnings for this sheet
        const warnings: string[] = [];
        if (sheet.countMismatchWarning) {
          warnings.push(sheet.countMismatchWarning);
        }
        if (sheet.semesterWarning) {
          warnings.push(sheet.semesterWarning);
        } else if (!sheet.examSession) {
          warnings.push('No examination semester heading identified.');
        }
        if (sheet.academicYearWarning) {
          warnings.push(sheet.academicYearWarning);
        } else if (sheet.academicYear === null || sheet.academicYear === undefined) {
          warnings.push('Academic year could not be determined from module code.');
        }

        const hasWarnings = warnings.length > 0;
        const isVerified =
          !hasWarnings &&
          sheet.printedTotal !== null &&
          sheet.printedTotal !== undefined &&
          sheet.rows.length === sheet.printedTotal;

        const isBeingReplaced = isReplacing && replacingTargetId === sheet.id;
        const isExpanded = !!expandedWarnings[sheet.id];

        return (
          <div
            key={sheet.id}
            className="sheet-item"
            style={{
              opacity: isBeingReplaced ? 0.6 : isExcluded ? 0.8 : 1,
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
              {/* Green / Red Module Selection Toggle */}
              <button
                type="button"
                className={`module-dot-btn ${isExcluded ? 'module-dot-btn--red' : 'module-dot-btn--green'}`}
                onClick={() => onToggleModule?.(sheet.courseCode)}
                role="switch"
                aria-checked={!isExcluded}
                aria-label={`${sheet.courseCode} is ${isExcluded ? 'excluded from' : 'included in'} GPA calculations. Click to ${isExcluded ? 'include' : 'exclude'}.`}
                title={`${sheet.courseCode}: ${isExcluded ? 'Excluded from GPA (Click to include)' : 'Included in GPA (Click to exclude)'}`}
              >
                <span className="module-dot" aria-hidden="true" />
              </button>

              <div
                className="sheet-item__icon"
                style={
                  isResit
                    ? { background: 'linear-gradient(135deg, #f59e0b, #d97706)' }
                    : undefined
                }
                aria-hidden="true"
              >
                {isResit ? '🔄' : '📋'}
              </div>

              <div className="sheet-item__info" style={{ flex: 1, minWidth: 0 }}>
                {/* Filename and badges */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <p
                    className="sheet-item__name"
                    title={fileDisplayName}
                    style={{ wordBreak: 'break-all', fontWeight: 600 }}
                  >
                    {fileDisplayName}
                  </p>

                  {/* Processing Status Badge */}
                  {hasWarnings ? (
                    <span
                      style={{
                        fontSize: '0.625rem',
                        padding: '0.1rem 0.45rem',
                        borderRadius: 'var(--r-full)',
                        background: 'rgba(239,68,68,0.15)',
                        color: 'var(--danger)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.2rem',
                      }}
                      title="Extraction completed with warnings that need review"
                    >
                      Needs Review ⚠️
                    </span>
                  ) : isVerified ? (
                    <span
                      style={{
                        fontSize: '0.625rem',
                        padding: '0.1rem 0.45rem',
                        borderRadius: 'var(--r-full)',
                        background: 'rgba(52,211,153,0.15)',
                        color: 'var(--success)',
                        border: '1px solid rgba(52,211,153,0.3)',
                        fontWeight: 700,
                      }}
                      title="Extracted total matches the official printed PDF student total"
                    >
                      Verified ✓
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '0.625rem',
                        padding: '0.1rem 0.45rem',
                        borderRadius: 'var(--r-full)',
                        background: 'rgba(99,102,241,0.12)',
                        color: 'var(--accent-1)',
                        border: '1px solid rgba(99,102,241,0.25)',
                        fontWeight: 600,
                      }}
                    >
                      Extracted
                    </span>
                  )}

                  {sheet.academicYear !== null && sheet.academicYear !== undefined ? (
                    <span
                      style={{
                        fontSize: '0.625rem',
                        padding: '0.1rem 0.4rem',
                        borderRadius: 'var(--r-full)',
                        background: 'rgba(99,102,241,0.12)',
                        color: 'var(--accent-1)',
                        border: '1px solid rgba(99,102,241,0.25)',
                        fontWeight: 600,
                        cursor: onUpdateAcademicYear ? 'pointer' : 'default',
                      }}
                      title={onUpdateAcademicYear ? 'Click to change academic year' : undefined}
                      onClick={() => onUpdateAcademicYear && startEditYear(sheet)}
                    >
                      Year {sheet.academicYear}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '0.625rem',
                        padding: '0.1rem 0.4rem',
                        borderRadius: 'var(--r-full)',
                        background: 'rgba(245,158,11,0.15)',
                        color: 'var(--warning)',
                        border: '1px solid rgba(245,158,11,0.3)',
                        fontWeight: 700,
                        cursor: onUpdateAcademicYear ? 'pointer' : 'default',
                      }}
                      title="Click to assign academic year"
                      onClick={() => onUpdateAcademicYear && startEditYear(sheet)}
                    >
                      ⚠️ Year ?
                    </span>
                  )}

                  {isResit && (
                    <span
                      style={{
                        fontSize: '0.625rem',
                        padding: '0.1rem 0.4rem',
                        borderRadius: 'var(--r-full)',
                        background: 'rgba(245,158,11,0.15)',
                        color: 'var(--warning)',
                        border: '1px solid rgba(245,158,11,0.3)',
                        fontWeight: 700,
                      }}
                    >
                      Resit
                    </span>
                  )}

                  {isExcluded && (
                    <span
                      style={{
                        fontSize: '0.625rem',
                        padding: '0.1rem 0.4rem',
                        borderRadius: 'var(--r-full)',
                        background: 'rgba(239,68,68,0.15)',
                        color: 'var(--danger)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        fontWeight: 700,
                      }}
                      title="Excluded from GPA calculations"
                    >
                      Excluded from GPA
                    </span>
                  )}
                </div>

                {/* Academic Year Editor */}
                {editingYearId === sheet.id && (
                  <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.25rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Academic Year:</span>
                    <select
                      value={tempYear}
                      onChange={(e) => setTempYear(e.target.value)}
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.15rem 0.4rem',
                        borderRadius: 'var(--r-sm)',
                        background: 'var(--bg-base)',
                        border: '1px solid var(--accent-2)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <option value="1">Year 1</option>
                      <option value="2">Year 2</option>
                      <option value="3">Year 3</option>
                      <option value="4">Year 4</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem' }}
                      onClick={() => saveEditYear(sheet.id)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      style={{ padding: '0.15rem 0.35rem', fontSize: '0.7rem' }}
                      onClick={() => setEditingYearId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Session editor / Metadata */}
                {isEditing ? (
                  <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.25rem' }}>
                    <input
                      type="text"
                      value={tempSession}
                      onChange={(e) => setTempSession(e.target.value)}
                      placeholder="e.g. Second Semester 2024"
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: 'var(--r-sm)',
                        background: 'var(--bg-base)',
                        border: '1px solid var(--accent-2)',
                        color: 'var(--text-primary)',
                        flex: 1,
                      }}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(sheet.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem' }}
                      onClick={() => saveEdit(sheet.id)}
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.15rem', flexWrap: 'wrap' }}>
                    <p className="sheet-item__meta" style={{ margin: 0 }}>
                      {hasSession ? (
                        sheet.examSession
                      ) : (
                        <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
                          ⚠️ No session found
                        </span>
                      )}{' '}
                      ·{' '}
                      {sheet.countMismatchWarning ? (
                        <span
                          style={{
                            color: 'var(--danger)',
                            fontWeight: 700,
                            cursor: 'help',
                          }}
                          title={sheet.countMismatchWarning}
                        >
                          ⚠️ {sheet.rows.length} students (PDF prints {sheet.printedTotal})
                        </span>
                      ) : sheet.printedTotal !== null && sheet.printedTotal !== undefined ? (
                        <span title={`Verified with printed PDF total of ${sheet.printedTotal} students`}>
                          {sheet.rows.length} students ✓
                        </span>
                      ) : (
                        <span>{sheet.rows.length} students</span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => startEdit(sheet)}
                      title={hasSession ? 'Edit semester session' : 'Assign semester session'}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-1)',
                        cursor: 'pointer',
                        fontSize: '0.6875rem',
                        padding: '0 0.25rem',
                        textDecoration: 'underline',
                      }}
                    >
                      {hasSession ? 'edit' : 'assign session'}
                    </button>

                    {/* Toggle warning details if warnings exist */}
                    {hasWarnings && (
                      <button
                        type="button"
                        onClick={() => toggleWarningDetails(sheet.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                          padding: '0 0.25rem',
                          textDecoration: 'underline',
                        }}
                        title="Click to view extraction warning details"
                      >
                        {isExpanded ? 'Hide warnings ▲' : `View ${warnings.length} warning${warnings.length > 1 ? 's' : ''} ▼`}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons: Replace & Remove */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                {onReplaceSheet && (
                  <button
                    type="button"
                    onClick={() => handleReplaceClick(sheet.id)}
                    disabled={isBeingReplaced}
                    aria-label={`Replace ${fileDisplayName}`}
                    title="Replace this result sheet with an updated PDF"
                    style={{
                      background: 'rgba(99,102,241,0.1)',
                      border: '1px solid rgba(99,102,241,0.3)',
                      color: 'var(--accent-1)',
                      cursor: isBeingReplaced ? 'wait' : 'pointer',
                      padding: '0.3rem 0.55rem',
                      borderRadius: 'var(--r-sm)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isBeingReplaced ? '⏳ Replacing…' : '🔄 Replace'}
                  </button>
                )}

                <button
                  type="button"
                  className="sheet-item__remove"
                  onClick={() => onRemove(sheet.id)}
                  aria-label={`Remove ${fileDisplayName}`}
                  title={`Remove ${fileDisplayName}`}
                  style={{
                    background: 'rgba(248,113,113,0.1)',
                    border: '1px solid rgba(248,113,113,0.25)',
                    color: 'var(--danger)',
                    cursor: 'pointer',
                    padding: '0.3rem 0.6rem',
                    borderRadius: 'var(--r-sm)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    whiteSpace: 'nowrap',
                    transition: 'all var(--t-fast)',
                  }}
                >
                  ✕ Remove
                </button>
              </div>
            </div>

            {/* Expandable Warnings Viewer */}
            {hasWarnings && isExpanded && (
              <div
                style={{
                  marginTop: '0.35rem',
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--r-sm)',
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.25)',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                }}
              >
                <div style={{ fontWeight: 700, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span>⚠️ Extraction Warnings:</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                  {warnings.map((warn, wIdx) => (
                    <li key={wIdx} style={{ color: 'var(--danger)' }}>
                      {warn}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SheetsList;
