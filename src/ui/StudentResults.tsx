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
  onSetManualCredit?: (moduleCode: string, credits: number) => void;
  onToggleExclude?: (indexNumber: string, moduleCode: string) => void;
}

const StudentResults: FC<StudentResultsProps> = ({
  result,
  onSetManualCredit,
  onToggleExclude,
}) => {
  const { indexNumber, semesters, cgpa, cgpaModuleCount, cgpaTotalCredits, classification } = result;

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

        {/* Overall stats badges */}
        <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="stat-chip stat-chip--cgpa" style={{ fontSize: '0.8125rem', padding: '0.35rem 0.75rem' }}>
            CGPA {cgpa.toFixed(2)}
          </span>
          {classification && (
            <span className="stat-chip stat-chip--class" style={{ fontSize: '0.8125rem', padding: '0.35rem 0.75rem' }}>
              {classification}
            </span>
          )}
          <span className="stat-chip stat-chip--modules" style={{ fontSize: '0.8125rem', padding: '0.35rem 0.75rem' }}>
            {cgpaModuleCount} modules / {cgpaTotalCredits} GPA cr
          </span>
        </div>
      </div>

      {/* ── Semester sections ── */}
      {semesters.map((sem, idx) => (
        <ResultsTable
          key={sem.semesterName + '-' + idx}
          result={sem}
          cgpa={cgpa}
          cgpaModuleCount={cgpaModuleCount}
          cgpaTotalCredits={cgpaTotalCredits}
          classification={classification}
          isLatest={idx === semesters.length - 1}
          onSetManualCredit={onSetManualCredit}
          onToggleExclude={onToggleExclude}
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
          <strong>from {cgpaModuleCount} module{cgpaModuleCount !== 1 ? 's' : ''} / {cgpaTotalCredits} GPA credits</strong>{' '}
          loaded in this session. The official award of any degree or class depends on meeting all academic criteria,
          including completion of all degree requirements and compulsory non-GPA components.
        </p>
      </div>
    </section>
  );
};

export default StudentResults;
