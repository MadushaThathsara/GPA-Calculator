/**
 * ui/SheetsList.tsx
 *
 * M4 — Displays the list of uploaded sheets.
 * Shows display name (<CourseCode>_<CourseName>.pdf), exam session, row count,
 * type (original / repeat-resit), inline semester editor, and a remove button.
 */

import { useState, type FC } from 'react';
import type { MockSheet } from '../store/useSessionStore';

interface SheetsListProps {
  sheets: MockSheet[];
  onRemove: (id: string) => void;
  onClearAll?: () => void;
  onUpdateSession?: (id: string, newSession: string) => void;
  onUpdateAcademicYear?: (id: string, newYear: number | null) => void;
}

const SheetsList: FC<SheetsListProps> = ({
  sheets,
  onRemove,
  onClearAll,
  onUpdateSession,
  onUpdateAcademicYear,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempSession, setTempSession] = useState('');
  const [editingYearId, setEditingYearId] = useState<string | null>(null);
  const [tempYear, setTempYear] = useState<string>('');

  if (sheets.length === 0) return null;

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

  return (
    <div className="sheets-list">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <p className="section-label" style={{ margin: 0 }}>Loaded Sheets ({sheets.length})</p>
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

        return (
          <div key={sheet.id} className="sheet-item">
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

            <div className="sheet-item__info">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                <p className="sheet-item__name" title={sheet.displayName}>
                  {sheet.displayName}
                </p>
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
                {sheet.semesterWarning && !sheet.examSession && (
                  <span
                    style={{
                      fontSize: '0.625rem',
                      padding: '0.1rem 0.35rem',
                      borderRadius: 'var(--r-sm)',
                      background: 'rgba(239,68,68,0.12)',
                      color: 'var(--danger)',
                      fontWeight: 600,
                    }}
                    title={sheet.semesterWarning}
                  >
                    ⚠️ No Exam Heading
                  </span>
                )}
              </div>

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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.15rem' }}>
                  <p className="sheet-item__meta">
                    {hasSession ? (
                      sheet.examSession
                    ) : (
                      <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
                        ⚠️ No session found
                      </span>
                    )}{' '}
                    · {sheet.rows.length} students
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
                </div>
              )}
            </div>

            <button
              type="button"
              className="sheet-item__remove"
              onClick={() => onRemove(sheet.id)}
              aria-label={`Remove ${sheet.displayName}`}
              title={`Remove ${sheet.displayName}`}
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
        );
      })}
    </div>
  );
};

export default SheetsList;
