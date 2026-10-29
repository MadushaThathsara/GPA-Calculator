/**
 * ui/GradeBadge.tsx
 *
 * Renders a coloured grade badge or status pill.
 * Colours follow the grade tier (A→green, B→blue, C→amber, D→orange, E→red).
 */

import type { FC } from 'react';

interface GradeBadgeProps {
  value: string | null;
}

function gradeClass(grade: string): string {
  if (grade.startsWith('A')) return 'grade-badge--a';
  if (grade.startsWith('B')) return 'grade-badge--b';
  if (grade.startsWith('C')) return 'grade-badge--c';
  if (grade === 'D') return 'grade-badge--d';
  if (grade === 'E') return 'grade-badge--e';
  return 'grade-badge--status';
}

const GradeBadge: FC<GradeBadgeProps> = ({ value }) => {
  if (!value) return <span style={{ color: 'var(--text-muted)' }}>—</span>;

  const cls = gradeClass(value);
  const isStatus = cls === 'grade-badge--status';

  return (
    <span
      className={`grade-badge ${cls}`}
      title={isStatus ? value : undefined}
    >
      {value}
    </span>
  );
};

export default GradeBadge;
