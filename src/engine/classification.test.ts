/**
 * engine/classification.test.ts
 *
 * Unit tests for classify() — the degree classification function from spec §4.
 *
 * Spec §4 boundaries (PROVISIONAL):
 *   First Class:          CGPA ≥ 3.70
 *   Second Class (Upper): CGPA ≥ 3.30
 *   Second Class (Lower): CGPA ≥ 3.00
 *   Pass:                 CGPA ≥ 2.00
 *
 * Per spec §16 test plan: "classification boundaries (3.70, 3.30, 3.00, 2.00)"
 */
import { describe, it, expect } from 'vitest';
import { classify } from './classification';
import type { ClassificationBand } from '../rules/schema';

const BANDS: ClassificationBand[] = [
  { label: 'First Class',           minCgpa: 3.70 },
  { label: 'Second Class (Upper)',  minCgpa: 3.30 },
  { label: 'Second Class (Lower)',  minCgpa: 3.00 },
  { label: 'Pass',                  minCgpa: 2.00 },
];

describe('classify', () => {
  // ── Exact boundary values ──────────────────────────────────────────────────

  it('returns First Class at exactly 3.70', () => {
    expect(classify(3.70, BANDS)).toBe('First Class');
  });

  it('returns Second Class (Upper) at exactly 3.30', () => {
    expect(classify(3.30, BANDS)).toBe('Second Class (Upper)');
  });

  it('returns Second Class (Lower) at exactly 3.00', () => {
    expect(classify(3.00, BANDS)).toBe('Second Class (Lower)');
  });

  it('returns Pass at exactly 2.00', () => {
    expect(classify(2.00, BANDS)).toBe('Pass');
  });

  // ── Just above boundary ────────────────────────────────────────────────────

  it('returns First Class at 3.71', () => {
    expect(classify(3.71, BANDS)).toBe('First Class');
  });

  it('returns Second Class (Upper) at 3.50', () => {
    expect(classify(3.50, BANDS)).toBe('Second Class (Upper)');
  });

  it('returns Second Class (Lower) at 3.10', () => {
    expect(classify(3.10, BANDS)).toBe('Second Class (Lower)');
  });

  it('returns Pass at 2.50', () => {
    expect(classify(2.50, BANDS)).toBe('Pass');
  });

  // ── Just below boundary ────────────────────────────────────────────────────

  it('returns Second Class (Upper) at 3.69 (just below First Class)', () => {
    expect(classify(3.69, BANDS)).toBe('Second Class (Upper)');
  });

  it('returns Second Class (Lower) at 3.29 (just below Upper)', () => {
    expect(classify(3.29, BANDS)).toBe('Second Class (Lower)');
  });

  it('returns Pass at 2.99 (just below Lower)', () => {
    expect(classify(2.99, BANDS)).toBe('Pass');
  });

  it('returns null at 1.99 (below Pass threshold)', () => {
    expect(classify(1.99, BANDS)).toBeNull();
  });

  it('returns null at 0', () => {
    expect(classify(0, BANDS)).toBeNull();
  });

  // ── High CGPA ──────────────────────────────────────────────────────────────

  it('returns First Class at 4.00', () => {
    expect(classify(4.00, BANDS)).toBe('First Class');
  });
});
