/**
 * engine/gpa.ts
 *
 * SGPA and CGPA calculation formulas from spec §4.
 *
 * SGPA = Σ(credits × grade points) ÷ Σ credits
 *   over GPA-eligible, counted modules in a semester.
 *
 * CGPA = same formula across all semesters.
 *
 * Results display as "from N modules / X GPA credits" (spec §4).
 */
import type { Grade, GradeScale } from '../rules/schema';

export type GpaInput = {
  /** Effective grade for GPA (null = excluded). */
  gpaGrade: Grade | null;
  credits: number;
};

export type GpaResult = {
  gpa: number;
  /** Number of GPA-counted modules. */
  moduleCount: number;
  /** Total GPA credits summed. */
  totalCredits: number;
};

/**
 * Calculates SGPA from an array of module inputs.
 * Excludes modules where gpaGrade is null.
 *
 * Computes using full floating-point precision without intermediate rounding.
 * Display formatting rounds to 4 decimal places via formatSgpa().
 *
 * @param modules - Array of GPA inputs (grade + credits per module).
 * @param scale - The grade scale from the university config.
 * @returns Full-precision SGPA, module count, and total credits.
 */
export function calculateSgpa(modules: GpaInput[], scale: GradeScale): GpaResult {
  return computeRawGpa(modules, scale);
}

/**
 * Calculates CGPA across all semesters (spec §4).
 * Retains underlying CGPA calculation (rounded to 2 decimal places).
 */
export function calculateCgpa(modules: GpaInput[], scale: GradeScale): GpaResult {
  const raw = computeRawGpa(modules, scale);
  const gpa = Math.round(raw.gpa * 100) / 100;
  return { ...raw, gpa };
}

function computeRawGpa(modules: GpaInput[], scale: GradeScale): GpaResult {
  let weightedSum = 0;
  let totalCredits = 0;
  let moduleCount = 0;

  for (const m of modules) {
    if (m.gpaGrade === null) continue; // excluded

    const points = scale[m.gpaGrade];
    if (points === undefined) {
      throw new Error(`Unknown grade "${m.gpaGrade}" in scale`);
    }

    weightedSum += points * m.credits;
    totalCredits += m.credits;
    moduleCount++;
  }

  if (totalCredits === 0) {
    return { gpa: 0, moduleCount: 0, totalCredits: 0 };
  }

  const gpa = weightedSum / totalCredits;
  return { gpa, moduleCount, totalCredits };
}

/**
 * Formats an SGPA value to exactly 4 decimal places for display.
 * Retains trailing zeros (e.g. 3.4567, 3.5000, 2.0000).
 *
 * @param sgpa - Numeric SGPA value.
 * @returns Formatted SGPA string with exactly 4 decimal places.
 */
export function formatSgpa(sgpa: number): string {
  if (!Number.isFinite(sgpa)) return '0.0000';
  return sgpa.toFixed(4);
}

/**
 * Formats an SGPA value for display with exactly 4 decimal places,
 * or returns 'N/A' when GPA is unavailable (e.g. 0 eligible GPA modules).
 *
 * @param sgpa - Numeric SGPA value.
 * @param moduleCount - Count of eligible GPA modules in the semester.
 * @returns Formatted SGPA string or 'N/A'.
 */
export function formatSgpaDisplay(sgpa: number, moduleCount: number): string {
  if (moduleCount === 0 || !Number.isFinite(sgpa)) return 'N/A';
  return sgpa.toFixed(4);
}

/**
 * Formats a CGPA value for display with 2 decimal places,
 * or returns 'N/A' when CGPA cannot yet be calculated (0 eligible GPA modules).
 *
 * @param cgpa - Numeric CGPA value.
 * @param moduleCount - Count of eligible GPA modules across all semesters.
 * @returns Formatted CGPA string or 'N/A'.
 */
export function formatCgpaDisplay(cgpa: number, moduleCount: number): string {
  if (moduleCount === 0 || !Number.isFinite(cgpa)) return 'N/A';
  return cgpa.toFixed(2);
}
