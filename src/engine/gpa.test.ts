/**
 * engine/gpa.test.ts
 *
 * Unit tests for calculateSgpa() and calculateCgpa() from spec §4.
 *
 * Formula: Σ(credits × grade points) ÷ Σ credits
 * Modules with gpaGrade === null are excluded.
 */
import { describe, it, expect } from 'vitest';
import { calculateSgpa, calculateCgpa, formatSgpa } from './gpa';
import type { GradeScale } from '../rules/schema';

// Use the provisional grade scale from spec §4
const SCALE: GradeScale = {
  'A+': 4.0, 'A': 4.0, 'A-': 3.7,
  'B+': 3.3, 'B': 3.0, 'B-': 2.7,
  'C+': 2.3, 'C': 2.0, 'C-': 1.3,
  'D': 1.0,  'E': 0.0,
};

describe('calculateSgpa', () => {
  it('returns 0 when no modules are GPA-eligible', () => {
    const result = calculateSgpa(
      [{ gpaGrade: null, credits: 3 }, { gpaGrade: null, credits: 2 }],
      SCALE,
    );
    expect(result.gpa).toBe(0);
    expect(result.moduleCount).toBe(0);
    expect(result.totalCredits).toBe(0);
  });

  it('handles a single A+ module correctly', () => {
    const result = calculateSgpa([{ gpaGrade: 'A+', credits: 3 }], SCALE);
    expect(result.gpa).toBe(4.0);
    expect(result.moduleCount).toBe(1);
    expect(result.totalCredits).toBe(3);
  });

  it('computes weighted average for mixed grades', () => {
    // A (4.0, cr 3) + B (3.0, cr 2) = (12 + 6) / 5 = 18/5 = 3.6
    const result = calculateSgpa(
      [{ gpaGrade: 'A', credits: 3 }, { gpaGrade: 'B', credits: 2 }],
      SCALE,
    );
    expect(result.gpa).toBe(3.6);
    expect(result.moduleCount).toBe(2);
    expect(result.totalCredits).toBe(5);
  });

  it('excludes null-grade modules from calculation', () => {
    // A (4.0, cr 3) + excluded (null, cr 2) = 12/3 = 4.0
    const result = calculateSgpa(
      [{ gpaGrade: 'A', credits: 3 }, { gpaGrade: null, credits: 2 }],
      SCALE,
    );
    expect(result.gpa).toBe(4.0);
    expect(result.moduleCount).toBe(1);
    expect(result.totalCredits).toBe(3);
  });

  it('handles E grade (0.0 points) correctly', () => {
    // A (4.0, cr 3) + E (0.0, cr 3) = (12 + 0) / 6 = 2.0
    const result = calculateSgpa(
      [{ gpaGrade: 'A', credits: 3 }, { gpaGrade: 'E', credits: 3 }],
      SCALE,
    );
    expect(result.gpa).toBe(2.0);
    expect(result.moduleCount).toBe(2);
    expect(result.totalCredits).toBe(6);
  });

  it('calculates with full floating-point precision without intermediate rounding', () => {
    // D (1.0, cr 3) + C (2.0, cr 4) = (3 + 8) / 7 = 11/7 = 1.5714285714285714...
    const result = calculateSgpa(
      [{ gpaGrade: 'D', credits: 3 }, { gpaGrade: 'C', credits: 4 }],
      SCALE,
    );
    expect(result.gpa).toBeCloseTo(11 / 7, 10);
    // Crucially: it is not pre-rounded to 2 decimal places (1.57)
    expect(result.gpa).not.toBe(1.57);
  });
});

describe('calculateCgpa', () => {
  it('produces the same result as SGPA for exact values', () => {
    const modules = [
      { gpaGrade: 'A' as const, credits: 3 },
      { gpaGrade: 'B' as const, credits: 2 },
    ];
    const sgpa = calculateSgpa(modules, SCALE);
    const cgpa = calculateCgpa(modules, SCALE);
    expect(cgpa.gpa).toBe(sgpa.gpa);
  });

  it('preserves underlying CGPA calculation rounded to 2 decimal places', () => {
    // 11 / 7 = 1.571428... -> CGPA rounded to 2 decimal places = 1.57
    const result = calculateCgpa(
      [{ gpaGrade: 'D', credits: 3 }, { gpaGrade: 'C', credits: 4 }],
      SCALE,
    );
    expect(result.gpa).toBe(1.57);
  });
});

describe('formatSgpa (4 decimal precision display)', () => {
  it('displays exactly 4 decimal places with trailing zeros', () => {
    expect(formatSgpa(3.5)).toBe('3.5000');
    expect(formatSgpa(2.0)).toBe('2.0000');
    expect(formatSgpa(4.0)).toBe('4.0000');
    expect(formatSgpa(0)).toBe('0.0000');
  });

  it('displays exact 4-decimal values accurately (e.g. 3.4567)', () => {
    expect(formatSgpa(3.4567)).toBe('3.4567');
    expect(formatSgpa(3.1234)).toBe('3.1234');
    expect(formatSgpa(2.9876)).toBe('2.9876');
  });

  it('rounds only the final display value without intermediate precision loss', () => {
    // 11 / 7 = 1.571428... -> rounds to 1.5714 (if pre-rounded to 1.57 it would have been 1.5700)
    expect(formatSgpa(11 / 7)).toBe('1.5714');
    // 24 / 7 = 3.428571... -> rounds to 3.4286
    expect(formatSgpa(24 / 7)).toBe('3.4286');
  });

  it('handles edge cases safely', () => {
    expect(formatSgpa(NaN)).toBe('0.0000');
    expect(formatSgpa(Infinity)).toBe('0.0000');
    expect(formatSgpa(-Infinity)).toBe('0.0000');
  });
});
