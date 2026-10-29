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

interface ResultsTableProps {
  result: SemesterResult;
  cgpa: number;
  cgpaModuleCount: number;
  cgpaTotalCredits: number;
  classification: string | null;
  isLatest?: boolean;
  onSetManualCredit?: (moduleCode: string, credits: number) => void;
  onToggleExclude?: (indexNumber: string, moduleCode: string) => void;
  studentIndexNumber: string;
}

const ResultsTable: FC<ResultsTableProps> = ({
  result,
  cgpa,
  cgpaModuleCount,
  cgpaTotalCredits,
  classification,
  isLatest = false,
  onSetManualCredit,
  onToggleExclude,
  studentIndexNumber,
}) => {
  const [open, setOpen] = useState(true);
  const [editingCreditModule, setEditingCreditModule] = useState<string | null>(null);
  const [tempCreditVal, setTempCreditVal] = useState<string>('');

  const { rows, sgpa, moduleCount, totalCredits } = result;

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

  return (
    <div className="semester-section animate-in">
      {/* ── Collapsible header ── */}
      <div
        className="semester-header"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => !o)}
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
              {moduleCount} module{moduleCount !== 1 ? 's' : ''} &nbsp;·&nbsp; {totalCredits} GPA credits
            </p>
          </div>
        </div>

        <div className="semester-header__right">
          {/* Stat chips */}
          <div className="stat-chips">
            <span className="stat-chip stat-chip--sgpa">
              SGPA {formatSgpa(sgpa)}
            </span>
            {isLatest && (
              <span className="stat-chip stat-chip--cgpa">
                CGPA {cgpa.toFixed(2)}
              </span>
            )}
            {isLatest && classification && (
              <span className="stat-chip stat-chip--class">
                {classification}
              </span>
            )}
            <span className="stat-chip stat-chip--modules">
              {moduleCount}M / {totalCredits}cr
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
                  <th scope="col" style={{ width: '40px', textAlign: 'center' }}>Incl.</th>
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
                {rows.map(({ row, courseName, credits, manualCreditApplied, gpaPoints, effectiveGrade, excluded, isUserExcluded, resitInfo, academicYear }) => {
                  const displayGrade = effectiveGrade ?? row.grade ?? row.status;
                  const isEditingCredit = editingCreditModule === row.moduleCode;

                  return (
                    <tr
                      key={row.indexNumber + row.moduleCode}
                      style={{ opacity: excluded ? 0.65 : 1 }}
                    >
                      {/* Include / Exclude Checkbox */}
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={!isUserExcluded}
                          onChange={() => onToggleExclude?.(studentIndexNumber, row.moduleCode)}
                          title={isUserExcluded ? 'Click to include in GPA' : 'Click to exclude from GPA'}
                          style={{ cursor: 'pointer', accentColor: 'var(--accent-2)' }}
                          aria-label={`Include ${row.moduleCode} in GPA`}
                        />
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

                      {/* Grade Badge */}
                      <td>
                        <GradeBadge value={displayGrade ?? null} />
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <FlagBadge flags={row.flags} />
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
                })}
              </tbody>
            </table>
          </div>

          {/* ── SGPA summary row ── */}
          <div className="gpa-summary">
            <div className="gpa-stat">
              <div className="gpa-stat__value">{formatSgpa(sgpa)}</div>
              <div className="gpa-stat__label">Semester GPA (SGPA)</div>
              <div className="gpa-stat__note">from {moduleCount} modules / {totalCredits} GPA credits</div>
            </div>

            {isLatest && (
              <>
                <div className="gpa-stat">
                  <div className="gpa-stat__value">{cgpa.toFixed(2)}</div>
                  <div className="gpa-stat__label">Cumulative GPA (CGPA)</div>
                  <div className="gpa-stat__note">from {cgpaModuleCount} modules / {cgpaTotalCredits} GPA credits</div>
                </div>

                {classification && (
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
