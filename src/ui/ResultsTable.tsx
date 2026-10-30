/**
 * ui/ResultsTable.tsx
 *
 * M5 — Per-semester results table.
 *
 * Shows:
 *  - Module code and course name
 *  - GPA credits with inline manual credit edit option (spec §3 flow 5, M5)
 *  - Grade with color-coded badge
 *  - Grade points
 *  - Status (e.g. AB(ESA), E(CA))
 *  - Resit note / original grade (when repeat applied, spec §4, M4)
 *  - Extraction indicators (OCR, Check this with comparison, Edited)
 *  - Module include/exclude toggle (spec A6, M5)
 *  - SGPA summary ("from N modules / X GPA credits")
 */

import { useState, type FC } from 'react';
import GradeBadge from './GradeBadge';
import FlagBadge from './FlagBadge';
import type { SemesterResult } from '../store/useSessionStore';
import { formatSgpa } from '../engine/gpa';
import { VALID_GRADES, VALID_STATUSES, isValidGradeOrStatus } from '../rules/schema';

const STATUS_OPTIONS = VALID_STATUSES.filter((s) => s !== 'E');

interface ResultsTableProps {
  result: SemesterResult;
  cgpa: number;
  cgpaModuleCount: number;
  cgpaTotalCredits: number;
  classification: string | null;
  hasCgpa?: boolean;
  isLatest?: boolean;
  moduleExclusions?: Record<string, boolean>;
  onSetManualCredit?: (moduleCode: string, credits: number) => void;
  onToggleExclude?: (indexNumber: string, moduleCode: string) => void;
  onToggleModule?: (moduleCode: string) => void;
  onSetGradeEdit?: (indexNumber: string, moduleCode: string, newValue: string, sheetId?: string) => void;
  onClearGradeEdit?: (indexNumber: string, moduleCode: string, sheetId?: string) => void;
  studentIndexNumber: string;
}

const ResultsTable: FC<ResultsTableProps> = ({
  result,
  cgpa,
  cgpaModuleCount,
  cgpaTotalCredits: _cgpaTotalCredits,
  classification,
  hasCgpa,
  isLatest = false,
  moduleExclusions: _moduleExclusions,
  onSetManualCredit,
  onToggleExclude,
  onToggleModule,
  onSetGradeEdit,
  onClearGradeEdit,
  studentIndexNumber,
}) => {
  const [open, setOpen] = useState(true);
  const [editingCreditModule, setEditingCreditModule] = useState<string | null>(null);
  const [tempCreditVal, setTempCreditVal] = useState<string>('');
  const [editingGradeRow, setEditingGradeRow] = useState<{ moduleCode: string; sheetId: string } | null>(null);
  const [tempGradeVal, setTempGradeVal] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);

  const { rows, sgpa } = result;
  const hasSgpa = result.hasGpa ?? (result.moduleCount > 0);
  const isCgpaAvailable = hasCgpa ?? (cgpaModuleCount > 0);

  const startEditCredit = (moduleCode: string, currentCredits: number) => {
    setEditingCreditModule(moduleCode);
    setTempCreditVal(String(currentCredits));
  };

  const saveCredit = (moduleCode: string) => {
    const val = parseInt(tempCreditVal, 10);
    if (!isNaN(val) && val >= 0) {
      onSetManualCredit?.(moduleCode, val);
    }
    setEditingCreditModule(null);
  };

  const startEditGrade = (moduleCode: string, sheetId: string, currentVal: string) => {
    setEditingGradeRow({ moduleCode, sheetId });
    setTempGradeVal(currentVal);
    setEditError(null);
  };

  const handleSaveGrade = (moduleCode: string, sheetId: string) => {
    if (tempGradeVal === '__RESET__') {
      onClearGradeEdit?.(studentIndexNumber, moduleCode, sheetId);
      setEditingGradeRow(null);
      setEditError(null);
      return;
    }
    if (!isValidGradeOrStatus(tempGradeVal)) {
      setEditError('Please select a valid grade or status.');
      return;
    }
    onSetGradeEdit?.(studentIndexNumber, moduleCode, tempGradeVal, sheetId);
    setEditingGradeRow(null);
    setEditError(null);
  };

  const cancelEditGrade = () => {
    setEditingGradeRow(null);
    setEditError(null);
  };

  return (
    <div className="semester-section animate-in">
      {/* ── Collapsible header ── */}
      <div
        className="semester-header"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        id={`semester-${result.semesterName.replace(/\s+/g, '-')}-header`}
      >
        <div className="semester-header__left">
          <span className="semester-header__dot" aria-hidden="true" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <p className="semester-header__name">{result.semesterName}</p>
              {result.isUnassigned && (
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
                >
                  ⚠️ Unassigned Session
                </span>
              )}
            </div>
            <p className="semester-header__session">
              Total Modules: {result.totalModules} &nbsp;·&nbsp; Total Course Credits: {result.totalCourseCredits}
            </p>
          </div>
        </div>

        <div className="semester-header__right">
          {/* Stat chips */}
          <div className="stat-chips">
            {hasSgpa ? (
              <span className="stat-chip stat-chip--sgpa">
                SGPA {formatSgpa(sgpa)}
              </span>
            ) : (
              <span
                className="stat-chip"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                }}
                title="No eligible GPA modules in this semester"
              >
                SGPA N/A
              </span>
            )}
            {isLatest && isCgpaAvailable && (
              <span className="stat-chip stat-chip--cgpa">
                CGPA {cgpa.toFixed(2)}
              </span>
            )}
            {isLatest && isCgpaAvailable && classification && (
              <span className="stat-chip stat-chip--class">
                {classification}
              </span>
            )}
            <span className="stat-chip stat-chip--modules">
              {result.totalModules}M / {result.totalCourseCredits}cr
            </span>
          </div>

          <span
            className={`semester-header__chevron${open ? ' semester-header__chevron--open' : ''}`}
            aria-hidden="true"
          >
            ▼
          </span>
        </div>
      </div>

      {/* ── Body ── */}
      {open && (
        <div>
          <div
            className="results-table-wrap"
            role="region"
            aria-labelledby={`semester-${result.semesterName.replace(/\s+/g, '-')}-header`}
          >
            <table className="results-table" aria-label={`Results for ${result.semesterName}`}>
              <thead>
                <tr>
                  <th scope="col" style={{ width: '44px', textAlign: 'center' }}>GPA</th>
                  <th scope="col">Module Code</th>
                  <th scope="col">GPA Cr.</th>
                  <th scope="col">Grade</th>
                  <th scope="col">Points</th>
                  <th scope="col">Status</th>
                  <th scope="col">Repeat / Resit</th>
                  <th scope="col">Indicators</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(
                  ({
                    row,
                    courseName,
                    credits,
                    manualCreditApplied,
                    gpaPoints,
                    effectiveGrade,
                    excluded,
                    isUserExcluded,
                    resitInfo,
                    academicYear,
                    sheetId,
                    originalGrade,
                    originalStatus,
                    isEdited,
                  }) => {
                    const displayGrade = effectiveGrade ?? row.grade ?? row.status;
                    const isEditingCredit = editingCreditModule === row.moduleCode;
                    const isEditingGrade =
                      editingGradeRow !== null &&
                      editingGradeRow.moduleCode === row.moduleCode &&
                      editingGradeRow.sheetId === sheetId;

                    return (
                      <tr
                        key={row.indexNumber + row.moduleCode}
                        style={{ opacity: excluded ? 0.65 : 1 }}
                      >
                        {/* Green / Red Module Selection Toggle */}
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className={`module-dot-btn ${isUserExcluded ? 'module-dot-btn--red' : 'module-dot-btn--green'}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onToggleModule) {
                                onToggleModule(row.moduleCode);
                              } else {
                                onToggleExclude?.(studentIndexNumber, row.moduleCode);
                              }
                            }}
                            role="switch"
                            aria-checked={!isUserExcluded}
                            aria-label={`${row.moduleCode} is ${isUserExcluded ? 'excluded from' : 'included in'} GPA calculations. Click to ${isUserExcluded ? 'include' : 'exclude'}.`}
                            title={`${row.moduleCode}: ${isUserExcluded ? 'Excluded from GPA (Click to include)' : 'Included in GPA (Click to exclude)'}`}
                          >
                            <span className="module-dot" aria-hidden="true" />
                          </button>
                        </td>

                        {/* Module Code & Course Name */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <code
                                style={{
                                  color: 'var(--text-primary)',
                                  fontFamily: 'inherit',
                                  fontWeight: 700,
                                }}
                              >
                                {row.moduleCode}
                              </code>
                              {academicYear && (
                                <span
                                  style={{
                                    fontSize: '0.625rem',
                                    padding: '0.05rem 0.35rem',
                                    borderRadius: 'var(--r-full)',
                                    background: 'rgba(99,102,241,0.12)',
                                    color: 'var(--accent-1)',
                                    border: '1px solid rgba(99,102,241,0.25)',
                                    fontWeight: 600,
                                  }}
                                  title={`Academic Year ${academicYear} module`}
                                >
                                  Y{academicYear}
                                </span>
                              )}
                            </div>
                            {courseName && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {courseName}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* GPA Credits (with inline editing) */}
                        <td>
                          {isEditingCredit ? (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              <input
                                type="number"
                                min="0"
                                max="10"
                                value={tempCreditVal}
                                onChange={(e) => setTempCreditVal(e.target.value)}
                                style={{
                                  width: '45px',
                                  padding: '0.15rem 0.3rem',
                                  fontSize: '0.8125rem',
                                  background: 'var(--bg-base)',
                                  border: '1px solid var(--accent-1)',
                                  borderRadius: 'var(--r-sm)',
                                  color: 'var(--text-primary)',
                                }}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveCredit(row.moduleCode);
                                  if (e.key === 'Escape') setEditingCreditModule(null);
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn--primary btn--sm"
                                style={{ padding: '0.1rem 0.35rem', fontSize: '0.6875rem' }}
                                onClick={() => saveCredit(row.moduleCode)}
                              >
                                ✓
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditCredit(row.moduleCode, credits)}
                              title="Click to edit GPA credits manually"
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: manualCreditApplied ? 'var(--accent-1)' : 'var(--text-secondary)',
                                fontWeight: manualCreditApplied ? 700 : 400,
                                textDecoration: 'underline dotted',
                                padding: 0,
                                fontFamily: 'inherit',
                                fontSize: '0.875rem',
                              }}
                            >
                              {credits > 0 ? credits : '0 (Edit)'}
                            </button>
                          )}
                        </td>

                        {/* Grade Badge & Editing */}
                        <td>
                          {isEditingGrade ? (
                            <div style={{ display: 'inline-flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                <select
                                  className="grade-edit-select"
                                  value={tempGradeVal}
                                  onChange={(e) => {
                                    setTempGradeVal(e.target.value);
                                    setEditError(null);
                                  }}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveGrade(row.moduleCode, sheetId);
                                    if (e.key === 'Escape') cancelEditGrade();
                                  }}
                                  aria-label={`Select grade or status for ${row.moduleCode}`}
                                >
                                  <optgroup label="Letter Grades">
                                    {VALID_GRADES.map((g) => (
                                      <option key={g} value={g}>
                                        {g}
                                      </option>
                                    ))}
                                  </optgroup>
                                  <optgroup label="Result Statuses">
                                    {STATUS_OPTIONS.map((s) => (
                                      <option key={s} value={s}>
                                        {s}
                                      </option>
                                    ))}
                                  </optgroup>
                                  {isEdited && (
                                    <optgroup label="Reset">
                                      <option value="__RESET__">
                                        ↺ Reset to Original ({originalGrade ?? originalStatus ?? '—'})
                                      </option>
                                    </optgroup>
                                  )}
                                </select>
                                <button
                                  type="button"
                                  className="btn btn--primary btn--sm"
                                  style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }}
                                  onClick={() => handleSaveGrade(row.moduleCode, sheetId)}
                                  title="Save grade or status"
                                  aria-label="Save grade"
                                >
                                  ✓
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem' }}
                                  onClick={cancelEditGrade}
                                  title="Cancel edit"
                                  aria-label="Cancel edit"
                                >
                                  ✕
                                </button>
                              </div>
                              {editError && (
                                <span style={{ color: 'var(--danger)', fontSize: '0.6875rem' }}>
                                  {editError}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                              <GradeBadge value={displayGrade ?? null} />
                              {isEdited && (
                                <span
                                  className="flag flag--edited"
                                  style={{ fontSize: '0.6875rem', padding: '0.1rem 0.35rem' }}
                                  title={`Manually edited (Original: ${originalGrade ?? originalStatus ?? '—'})`}
                                >
                                  ✏️ Edited
                                </span>
                              )}
                              <button
                                type="button"
                                className="grade-edit-btn"
                                onClick={() =>
                                  startEditGrade(
                                    row.moduleCode,
                                    sheetId,
                                    (isEdited ? (row.grade ?? row.status) : (row.grade ?? row.status)) ?? 'A',
                                  )
                                }
                                title={
                                  isEdited
                                    ? `Edit corrected grade/status (Original: ${originalGrade ?? originalStatus ?? '—'})`
                                    : 'Edit grade or status'
                                }
                                aria-label={`Edit grade or status for ${row.moduleCode}`}
                              >
                                ✏️
                              </button>
                            </div>
                          )}
                        </td>

                        {/* Points */}
                        <td>
                          {excluded ? (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                              {isUserExcluded ? 'Excluded' : 'Excluded'}
                            </span>
                          ) : gpaPoints !== null ? (
                            <span style={{ color: 'var(--accent-1)', fontWeight: 600 }}>
                              {gpaPoints.toFixed(1)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>

                        {/* Status */}
                        <td>
                          {row.status ? (
                            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                              {row.status}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>

                        {/* Repeat / Resit Notes */}
                        <td>
                          {resitInfo ? (
                            <div style={{ fontSize: '0.75rem', lineHeight: 1.3 }}>
                              {resitInfo.originalGrade && (
                                <span style={{ color: 'var(--text-muted)' }}>
                                  Orig: {resitInfo.originalGrade} →{' '}
                                </span>
                              )}
                              <span
                                style={{
                                  color: resitInfo.capped ? 'var(--warning)' : 'var(--success)',
                                  fontWeight: 600,
                                }}
                              >
                                {resitInfo.repeatGrade}
                              </span>
                              {resitInfo.capped && (
                                <span
                                  style={{
                                    marginLeft: '0.25rem',
                                    fontSize: '0.6875rem',
                                    color: 'var(--warning)',
                                  }}
                                >
                                  (capped at B)
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                          )}
                        </td>

                        {/* Indicator Flags (with readings comparison on hover) */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <FlagBadge flags={row.flags} />
                            {isEdited && (
                              <span
                                style={{
                                  fontSize: '0.6875rem',
                                  color: 'var(--text-muted)',
                                }}
                                title={`Original extracted: "${originalGrade ?? originalStatus ?? '—'}"`}
                              >
                                (Orig: {originalGrade ?? originalStatus ?? '—'})
                              </span>
                            )}
                            {row.flags.includes('check-this') && (
                              <span
                                style={{
                                  fontSize: '0.6875rem',
                                  color: 'var(--text-muted)',
                                }}
                                title={`Text layer: "${row.textReading}" vs OCR: "${row.ocrReading}" (OCR wins)`}
                              >
                                ({row.textReading} vs {row.ocrReading})
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>

          {/* ── Semester-wise Summary (M7) ── */}
          <div className="gpa-summary" aria-label={`Semester Summary for ${result.semesterName}`}>
            {/* Semester Name */}
            <div className="gpa-stat">
              <div
                className="gpa-stat__value"
                style={{
                  fontSize: '1.05rem',
                  lineHeight: '1.3',
                  background: 'none',
                  WebkitTextFillColor: 'initial',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  marginBottom: '0.35rem',
                }}
              >
                {result.semesterName}
              </div>
              <div className="gpa-stat__label">Semester Name</div>
              <div className="gpa-stat__note">
                {result.isUnassigned ? 'Unassigned Session' : 'Examination Session'}
              </div>
            </div>

            {/* Total Modules */}
            <div className="gpa-stat">
              <div className="gpa-stat__value">{result.totalModules}</div>
              <div className="gpa-stat__label">Total Modules</div>
              <div className="gpa-stat__note">GPA + Non-GPA modules</div>
            </div>

            {/* Total Course Credits */}
            <div className="gpa-stat">
              <div className="gpa-stat__value">{result.totalCourseCredits}</div>
              <div className="gpa-stat__label">Total Course Credits</div>
              <div className="gpa-stat__note">GPA + Non-GPA credits</div>
            </div>

            {/* SGPA (exactly 4 decimal places) */}
            <div className="gpa-stat">
              {hasSgpa ? (
                <>
                  <div className="gpa-stat__value">{formatSgpa(sgpa)}</div>
                  <div className="gpa-stat__label">Semester GPA (SGPA)</div>
                  <div className="gpa-stat__note">
                    from {result.moduleCount} module{result.moduleCount !== 1 ? 's' : ''} ({result.totalCredits} GPA cr)
                  </div>
                </>
              ) : (
                <>
                  <div className="gpa-stat__value summary-stat-box__value--na" style={{ fontSize: '1.25rem' }}>
                    N/A
                  </div>
                  <div className="gpa-stat__label">Semester GPA (SGPA)</div>
                  <div className="gpa-stat__note summary-stat-box__sub--warning">
                    No eligible GPA modules in this semester
                  </div>
                </>
              )}
            </div>

            {isLatest && (
              <>
                <div className="gpa-stat">
                  {isCgpaAvailable ? (
                    <>
                      <div className="gpa-stat__value">{cgpa.toFixed(2)}</div>
                      <div className="gpa-stat__label">Cumulative GPA (CGPA)</div>
                      <div className="gpa-stat__note">calculated from GPA-eligible modules</div>
                    </>
                  ) : (
                    <>
                      <div className="gpa-stat__value summary-stat-box__value--na" style={{ fontSize: '1.25rem' }}>
                        N/A
                      </div>
                      <div className="gpa-stat__label">Cumulative GPA (CGPA)</div>
                      <div className="gpa-stat__note summary-stat-box__sub--warning">
                        CGPA cannot yet be calculated
                      </div>
                    </>
                  )}
                </div>

                {isCgpaAvailable && classification && (
                  <div className="gpa-stat">
                    <div
                      className="gpa-stat__value"
                      style={{ fontSize: '1rem', lineHeight: '1.4', marginBottom: '0.375rem' }}
                    >
                      <span className="classification-badge">🎓 {classification}</span>
                    </div>
                    <div className="gpa-stat__label">Degree Classification</div>
                    <div className="gpa-stat__note">provisional, subject to completion</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ResultsTable;
