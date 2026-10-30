/**
 * ui/StudentResults.tsx
 *
 * M5 — Full student view: all semesters + overall CGPA + classification.
 * Spec §5: "Results per semester with module code, GPA credits, grade,
 * points, status, indicators … SGPA, CGPA, classification, and the note
 * that the final award depends on other requirements."
 */

import type { FC } from 'react';
import ResultsTable from './ResultsTable';
import type { StudentSearchResult } from '../store/useSessionStore';

interface StudentResultsProps {
  result: StudentSearchResult;
  moduleExclusions?: Record<string, boolean>;
  onSetManualCredit?: (moduleCode: string, credits: number) => void;
  onToggleExclude?: (indexNumber: string, moduleCode: string) => void;
  onToggleModule?: (moduleCode: string) => void;
  onSetGradeEdit?: (indexNumber: string, moduleCode: string, newValue: string, sheetId?: string) => void;
  onClearGradeEdit?: (indexNumber: string, moduleCode: string, sheetId?: string) => void;
}

const StudentResults: FC<StudentResultsProps> = ({
  result,
  moduleExclusions,
  onSetManualCredit,
  onToggleExclude,
  onToggleModule,
  onSetGradeEdit,
  onClearGradeEdit,
}) => {
  const { indexNumber, semesters, cgpa, classification } = result;
  const hasCgpa = result.hasCgpa ?? (result.cgpaModuleCount > 0);

  return (
    <section aria-label={`Results for ${indexNumber}`} className="animate-in">
      {/* ── Student identity bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.875rem',
          marginBottom: '1.25rem',
          padding: '1rem 1.25rem',
          background: 'rgba(99,102,241,0.07)',
          border: '1px solid rgba(99,102,241,0.22)',
          borderRadius: 'var(--r-md)',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent-2), var(--violet-dark))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
            flexShrink: 0,
            boxShadow: 'var(--shadow-glow)',
          }}
          aria-hidden="true"
        >
          🎓
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ fontWeight: 800, fontSize: '1.125rem', color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
            {indexNumber}
          </p>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Academic record across {semesters.length} semester{semesters.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Overall stats badges — Course Summary chips */}
        <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {hasCgpa ? (
            <span className="stat-chip stat-chip--cgpa" style={{ fontSize: '0.8125rem', padding: '0.35rem 0.75rem' }}>
              CGPA {cgpa.toFixed(2)}
            </span>
          ) : (
            <span
              className="stat-chip"
              style={{
                fontSize: '0.8125rem',
                padding: '0.35rem 0.75rem',
                background: 'rgba(255,255,255,0.05)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
              title="CGPA cannot yet be calculated (no eligible GPA modules)"
            >
              CGPA N/A
            </span>
          )}
          {hasCgpa && classification && (
            <span className="stat-chip stat-chip--class" style={{ fontSize: '0.8125rem', padding: '0.35rem 0.75rem' }}>
              {classification}
            </span>
          )}
          <span className="stat-chip stat-chip--modules" style={{ fontSize: '0.8125rem', padding: '0.35rem 0.75rem' }}>
            Total Course Credits: {result.totalCourseCredits}
          </span>
          <span className="stat-chip stat-chip--modules" style={{ fontSize: '0.8125rem', padding: '0.35rem 0.75rem' }}>
            Total Modules: {result.totalModules}
          </span>
        </div>
      </div>

      {/* ── Overall Course Summary Card (M7) ── */}
      <div className="card course-summary-card animate-in" style={{ marginBottom: '1.5rem' }} aria-label="Overall Course Summary">
        <div className="card__header" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <div className="card__icon card__icon--indigo" aria-hidden="true">📊</div>
            <div>
              <p className="card__title" style={{ fontSize: '1.05rem', fontWeight: 700 }}>Overall Course Summary</p>
              <p className="card__subtitle" style={{ fontSize: '0.75rem' }}>
                Cumulative academic progress across all {semesters.length} loaded semester{semesters.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="course-summary-grid">
          {/* Total Course Credits */}
          <div className="summary-stat-box">
            <div className="summary-stat-box__value">{result.totalCourseCredits}</div>
            <div className="summary-stat-box__label">Total Course Credits</div>
            <div className="summary-stat-box__sub">GPA + Non-GPA modules</div>
          </div>

          {/* Total Modules */}
          <div className="summary-stat-box">
            <div className="summary-stat-box__value">{result.totalModules}</div>
            <div className="summary-stat-box__label">Total Modules</div>
            <div className="summary-stat-box__sub">GPA + Non-GPA modules</div>
          </div>

          {/* Overall CGPA */}
          <div className="summary-stat-box">
            {hasCgpa ? (
              <>
                <div className="summary-stat-box__value summary-stat-box__value--cgpa">
                  {cgpa.toFixed(2)}
                </div>
                <div className="summary-stat-box__label">Overall CGPA</div>
                <div className="summary-stat-box__sub">
                  from {result.cgpaModuleCount} module{result.cgpaModuleCount !== 1 ? 's' : ''} ({result.cgpaTotalCredits} GPA cr)
                </div>
              </>
            ) : (
              <>
                <div className="summary-stat-box__value summary-stat-box__value--na">N/A</div>
                <div className="summary-stat-box__label">Overall CGPA</div>
                <div className="summary-stat-box__sub summary-stat-box__sub--warning">
                  CGPA cannot yet be calculated (no eligible GPA modules)
                </div>
              </>
            )}
          </div>

          {/* Degree Classification */}
          <div className="summary-stat-box">
            {hasCgpa && classification ? (
              <>
                <div className="summary-stat-box__value summary-stat-box__value--class">
                  🎓 {classification}
                </div>
                <div className="summary-stat-box__label">Degree Classification</div>
                <div className="summary-stat-box__sub">provisional, subject to completion</div>
              </>
            ) : hasCgpa ? (
              <>
                <div className="summary-stat-box__value" style={{ fontSize: '1.125rem', color: 'var(--text-muted)' }}>
                  —
                </div>
                <div className="summary-stat-box__label">Degree Classification</div>
                <div className="summary-stat-box__sub">Below minimum class threshold</div>
              </>
            ) : (
              <>
                <div className="summary-stat-box__value summary-stat-box__value--na">—</div>
                <div className="summary-stat-box__label">Degree Classification</div>
                <div className="summary-stat-box__sub">Available once GPA modules are included</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Semester sections ── */}
      {semesters.map((sem, idx) => (
        <ResultsTable
          key={sem.semesterName + '-' + idx}
          result={sem}
          cgpa={cgpa}
          cgpaModuleCount={result.cgpaModuleCount}
          cgpaTotalCredits={result.cgpaTotalCredits}
          classification={classification}
          hasCgpa={hasCgpa}
          isLatest={idx === semesters.length - 1}
          moduleExclusions={moduleExclusions}
          onSetManualCredit={onSetManualCredit}
          onToggleExclude={onToggleExclude}
          onToggleModule={onToggleModule}
          onSetGradeEdit={onSetGradeEdit}
          onClearGradeEdit={onClearGradeEdit}
          studentIndexNumber={indexNumber}
        />
      ))}

      {/* ── Official Disclaimer note (Spec §4 & §15 M5) ── */}
      <div
        style={{
          marginTop: '1.25rem',
          padding: '0.875rem 1rem',
          background: 'rgba(255,255,255,0.02)',
          borderLeft: '3px solid var(--accent-2)',
          borderRadius: '0 var(--r-md) var(--r-md) 0',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>Note on calculations:</strong> Cumulative GPA (CGPA) displayed above is calculated exclusively{' '}
          from the selected GPA-eligible modules loaded in this session. The official award of any degree or class depends on meeting all academic criteria,
          including completion of all degree requirements and compulsory non-GPA components.
        </p>
      </div>
    </section>
  );
};

export default StudentResults;
