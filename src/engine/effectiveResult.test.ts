/**
 * engine/effectiveResult.test.ts
 *
 * Exhaustive unit tests for the specification §4 repeat/resit table:
 *  - Cap at B for eligible originals (C-, D, E, E(CA), E(ESA)) when repeat is above B
 *  - Cap boundary: repeat B+ gives 3.0, repeat B gives 3.0, repeat B- gives 2.7
 *  - Lower repeat replaces eligible original (e.g. C- -> D gives 1.0)
 *  - Eligible original with repeat E, E(CA), or E(ESA) counts as 0.0
 *  - AB-type originals get full uncapped repeat grade (e.g. A = 4.0)
 *  - Originals of B or higher and C+/C remain unchanged
 *  - Repeat AB, N, or W leaves the original unchanged
 *  - Original N or W remains excluded
 *  - isGradableResit helper tests
 */

import { describe, it, expect } from 'vitest';
import { effectiveResult, isGradableResit } from './effectiveResult';
import uocConfig from '../rules/universities/uoc';

describe('effectiveResult — Specification §4 Repeat/Resit Table', () => {
  // ── Cap boundary tests (Spec §11 & §15 M1) ───────────────────────────────────
  describe('Cap at B boundary for eligible originals (C-, D, E, E(CA), E(ESA))', () => {
    it('Original D + repeat B+ (3.3) -> capped at B (3.0)', () => {
      const res = effectiveResult({
        originalGrade: 'D',
        originalStatus: null,
        repeatGrade: 'B+',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('B');
      expect(res.capped).toBe(true);
      expect(res.excluded).toBe(false);
      expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(3.0);
    });

    it('Original D + repeat A- (3.7) -> capped at B (3.0)', () => {
      const res = effectiveResult({
        originalGrade: 'D',
        originalStatus: null,
        repeatGrade: 'A-',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('B');
      expect(res.capped).toBe(true);
      expect(res.excluded).toBe(false);
    });

    it('Original D + repeat A (4.0) -> capped at B (3.0)', () => {
      const res = effectiveResult({
        originalGrade: 'D',
        originalStatus: null,
        repeatGrade: 'A',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('B');
      expect(res.capped).toBe(true);
      expect(res.excluded).toBe(false);
    });

    it('Original D + repeat A+ (4.0) -> capped at B (3.0)', () => {
      const res = effectiveResult({
        originalGrade: 'D',
        originalStatus: null,
        repeatGrade: 'A+',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('B');
      expect(res.capped).toBe(true);
      expect(res.excluded).toBe(false);
    });

    it('Original D + repeat B (3.0) -> exactly B (3.0, not capped)', () => {
      const res = effectiveResult({
        originalGrade: 'D',
        originalStatus: null,
        repeatGrade: 'B',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('B');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
      expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(3.0);
    });

    it('Original D + repeat B- (2.7) -> exactly B- (2.7, not capped)', () => {
      const res = effectiveResult({
        originalGrade: 'D',
        originalStatus: null,
        repeatGrade: 'B-',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('B-');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
      expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(2.7);
    });
  });

  // ── Lower repeat replaces eligible original ──────────────────────────────────
  describe('Lower repeat replaces eligible original (Spec §4)', () => {
    it('Original C- + repeat D -> gives D (1.0)', () => {
      const res = effectiveResult({
        originalGrade: 'C-',
        originalStatus: null,
        repeatGrade: 'D',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('D');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
      expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(1.0);
    });

    it('Original C- + repeat E -> gives E (0.0)', () => {
      const res = effectiveResult({
        originalGrade: 'C-',
        originalStatus: null,
        repeatGrade: 'E',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('E');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
      expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(0.0);
    });
  });

  // ── Eligible original with repeat E-statuses & non-replacing statuses ────────
  describe('Eligible original with repeat failure statuses', () => {
    it('Repeat statuses (AB, AB(ESA), E(CA), E(ESA), N, W) must not replace original result', () => {
      // Original D + repeat E(ESA) -> original D remains
      const resD = effectiveResult({
        originalGrade: 'D',
        originalStatus: null,
        repeatGrade: null,
        repeatStatus: 'E(ESA)',
        config: uocConfig,
      });
      expect(resD.gpaGrade).toBe('D');
      expect(resD.capped).toBe(false);
      expect(resD.excluded).toBe(false);

      // Original C- + repeat E(CA) -> original C- remains
      const resC = effectiveResult({
        originalGrade: 'C-',
        originalStatus: null,
        repeatGrade: null,
        repeatStatus: 'E(CA)',
        config: uocConfig,
      });
      expect(resC.gpaGrade).toBe('C-');
      expect(resC.capped).toBe(false);
      expect(resC.excluded).toBe(false);
    });

    // ── M9 Audit Part 2: Dedicated 7 E(CA) / E(ESA) Repeat Scenarios ────────
    describe('M9 Part 2 — Required 7 E(CA) / E(ESA) Repeat Scenarios', () => {
      // Scenario 1: Original E(CA) + repeat A -> B (3.0)
      it('Scenario 1: Original E(CA) + repeat A -> B (3.0, capped)', () => {
        const res = effectiveResult({
          originalGrade: null,
          originalStatus: 'E(CA)',
          repeatGrade: 'A',
          repeatStatus: null,
          config: uocConfig,
        });
        expect(res.gpaGrade).toBe('B');
        expect(res.capped).toBe(true);
        expect(res.excluded).toBe(false);
        expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(3.0);
      });

      // Scenario 2: Original E(CA) + repeat B+ -> B (3.0)
      it('Scenario 2: Original E(CA) + repeat B+ -> B (3.0, capped)', () => {
        const res = effectiveResult({
          originalGrade: null,
          originalStatus: 'E(CA)',
          repeatGrade: 'B+',
          repeatStatus: null,
          config: uocConfig,
        });
        expect(res.gpaGrade).toBe('B');
        expect(res.capped).toBe(true);
        expect(res.excluded).toBe(false);
        expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(3.0);
      });

      // Scenario 3: Original E(CA) + repeat B -> B (3.0)
      it('Scenario 3: Original E(CA) + repeat B -> B (3.0, uncapped)', () => {
        const res = effectiveResult({
          originalGrade: null,
          originalStatus: 'E(CA)',
          repeatGrade: 'B',
          repeatStatus: null,
          config: uocConfig,
        });
        expect(res.gpaGrade).toBe('B');
        expect(res.capped).toBe(false);
        expect(res.excluded).toBe(false);
        expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(3.0);
      });

      // Scenario 4: Original E(CA) + repeat C+ -> C+ (actual grade)
      it('Scenario 4: Original E(CA) + repeat C+ -> C+ (2.3, actual grade)', () => {
        const res = effectiveResult({
          originalGrade: null,
          originalStatus: 'E(CA)',
          repeatGrade: 'C+',
          repeatStatus: null,
          config: uocConfig,
        });
        expect(res.gpaGrade).toBe('C+');
        expect(res.capped).toBe(false);
        expect(res.excluded).toBe(false);
        expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(2.3);
      });

      // Scenario 5: Original E(CA) + repeat AB -> original E(CA) remains effective and excluded
      it('Scenario 5: Original E(CA) + repeat AB -> original E(CA) remains effective and excluded', () => {
        const res = effectiveResult({
          originalGrade: null,
          originalStatus: 'E(CA)',
          repeatGrade: null,
          repeatStatus: 'AB',
          config: uocConfig,
        });
        expect(res.gpaGrade).toBeNull();
        expect(res.capped).toBe(false);
        expect(res.excluded).toBe(true);
      });

      // Scenario 6: Original E(ESA) + repeat A -> B (3.0)
      it('Scenario 6: Original E(ESA) + repeat A -> B (3.0, capped)', () => {
        const res = effectiveResult({
          originalGrade: null,
          originalStatus: 'E(ESA)',
          repeatGrade: 'A',
          repeatStatus: null,
          config: uocConfig,
        });
        expect(res.gpaGrade).toBe('B');
        expect(res.capped).toBe(true);
        expect(res.excluded).toBe(false);
        expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(3.0);
      });

      // Scenario 7: Original E(CA) without a repeat -> excluded from GPA
      it('Scenario 7: Original E(CA) without a repeat -> excluded from GPA', () => {
        const res = effectiveResult({
          originalGrade: null,
          originalStatus: 'E(CA)',
          repeatGrade: null,
          repeatStatus: null,
          config: uocConfig,
        });
        expect(res.gpaGrade).toBeNull();
        expect(res.capped).toBe(false);
        expect(res.excluded).toBe(true);
      });
    });

    it('Original status E(ESA) + repeat A -> capped at B (3.0)', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'E(ESA)',
        repeatGrade: 'A',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('B');
      expect(res.capped).toBe(true);
      expect(res.excluded).toBe(false);
    });

    it('Original status E(CA) + repeat C -> actual repeat C used (2.0)', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'E(CA)',
        repeatGrade: 'C',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('C');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
      expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(2.0);
    });
  });

  // ── AB-type originals get full repeat grade (no cap) ─────────────────────────
  describe('AB-type originals get full repeat grade (no cap)', () => {
    it('Original AB(ESA) + repeat A -> full A (4.0), no cap', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'AB(ESA)',
        repeatGrade: 'A',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('A');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
      expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(4.0);
    });

    it('Original bare AB + repeat A+ -> full A+ (4.0), no cap', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'AB',
        repeatGrade: 'A+',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('A+');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
    });

    it('Original AB(CA) & AB(ESA) + repeat B+ -> full B+ (3.3), no cap', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'AB(CA) & AB(ESA)',
        repeatGrade: 'B+',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('B+');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
      expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(3.3);
    });

    it('Original E(CA) & AB(ESA) + repeat A- -> full A- (3.7), no cap', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'E(CA) & AB(ESA)',
        repeatGrade: 'A-',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('A-');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
      expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(3.7);
    });
  });

  // ── Originals of B or higher and C+/C remain unchanged ───────────────────────
  describe('Originals of B or higher and C+/C remain unchanged', () => {
    it('Original A + repeat B -> original A kept (4.0)', () => {
      const res = effectiveResult({
        originalGrade: 'A',
        originalStatus: null,
        repeatGrade: 'B',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('A');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
    });

    it('Original B + repeat A -> original B kept (3.0)', () => {
      const res = effectiveResult({
        originalGrade: 'B',
        originalStatus: null,
        repeatGrade: 'A',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('B');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
    });

    it('Original C + repeat A -> original C kept (2.0)', () => {
      const res = effectiveResult({
        originalGrade: 'C',
        originalStatus: null,
        repeatGrade: 'A',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('C');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
      expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(2.0);
    });

    it('Original C+ + repeat A -> original C+ kept (2.3)', () => {
      const res = effectiveResult({
        originalGrade: 'C+',
        originalStatus: null,
        repeatGrade: 'A',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('C+');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
      expect(uocConfig.gradeScale[res.gpaGrade!]).toBe(2.3);
    });
  });

  // ── Neutral repeat results (AB, N, W) leave original unchanged ───────────────
  describe('Repeat result of AB, N, or W leaves original unchanged', () => {
    it('Original D + repeat status AB(ESA) -> original D kept (1.0)', () => {
      const res = effectiveResult({
        originalGrade: 'D',
        originalStatus: null,
        repeatGrade: null,
        repeatStatus: 'AB(ESA)',
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('D');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
    });

    it('Original D + repeat status bare AB -> original D kept', () => {
      const res = effectiveResult({
        originalGrade: 'D',
        originalStatus: null,
        repeatGrade: null,
        repeatStatus: 'AB',
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('D');
    });

    it('Original C- + repeat status N -> original C- kept (1.3)', () => {
      const res = effectiveResult({
        originalGrade: 'C-',
        originalStatus: null,
        repeatGrade: null,
        repeatStatus: 'N',
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('C-');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
    });

    it('Original C- + repeat status W -> original C- kept', () => {
      const res = effectiveResult({
        originalGrade: 'C-',
        originalStatus: null,
        repeatGrade: null,
        repeatStatus: 'W',
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('C-');
    });

    it('Original AB(ESA) + repeat status N -> original AB(ESA) kept (excluded)', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'AB(ESA)',
        repeatGrade: null,
        repeatStatus: 'N',
        config: uocConfig,
      });
      expect(res.gpaGrade).toBeNull();
      expect(res.excluded).toBe(true);
    });
  });

  // ── Original N or W remains excluded ─────────────────────────────────────────
  describe('Original N or W remains excluded', () => {
    it('Original N + repeat A -> stays excluded', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'N',
        repeatGrade: 'A',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBeNull();
      expect(res.excluded).toBe(true);
    });

    it('Original W + repeat B -> stays excluded', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'W',
        repeatGrade: 'B',
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBeNull();
      expect(res.excluded).toBe(true);
    });
  });

  // ── No repeat result ────────────────────────────────────────────────────────
  describe('No repeat result exists', () => {
    it('Standard original grade A- resolves cleanly', () => {
      const res = effectiveResult({
        originalGrade: 'A-',
        originalStatus: null,
        repeatGrade: null,
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBe('A-');
      expect(res.capped).toBe(false);
      expect(res.excluded).toBe(false);
    });

    it('Original status AB(ESA) without repeat is excluded', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'AB(ESA)',
        repeatGrade: null,
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBeNull();
      expect(res.excluded).toBe(true);
    });

    it('Original status E(CA) without repeat is excluded from GPA', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'E(CA)',
        repeatGrade: null,
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBeNull();
      expect(res.excluded).toBe(true);
    });

    it('Original status E(ESA) without repeat is excluded from GPA', () => {
      const res = effectiveResult({
        originalGrade: null,
        originalStatus: 'E(ESA)',
        repeatGrade: null,
        repeatStatus: null,
        config: uocConfig,
      });
      expect(res.gpaGrade).toBeNull();
      expect(res.excluded).toBe(true);
    });
  });

  // ── isGradableResit helper ──────────────────────────────────────────────────
  describe('isGradableResit', () => {
    it('returns true for any letter grade', () => {
      expect(isGradableResit('A', null)).toBe(true);
      expect(isGradableResit('B+', null)).toBe(true);
      expect(isGradableResit('D', null)).toBe(true);
      expect(isGradableResit('E', null)).toBe(true);
    });

    it('returns true for failure in-GPA status E', () => {
      expect(isGradableResit(null, 'E')).toBe(true);
    });

    it('returns false for failure statuses E(ESA) and E(CA) which are excluded from GPA', () => {
      expect(isGradableResit(null, 'E(ESA)')).toBe(false);
      expect(isGradableResit(null, 'E(CA)')).toBe(false);
    });

    it('returns false for ungradable / absent statuses', () => {
      expect(isGradableResit(null, 'AB')).toBe(false);
      expect(isGradableResit(null, 'AB(ESA)')).toBe(false);
      expect(isGradableResit(null, 'AB(CA)')).toBe(false);
      expect(isGradableResit(null, 'AB(CA) & AB(ESA)')).toBe(false);
      expect(isGradableResit(null, 'N')).toBe(false);
      expect(isGradableResit(null, 'W')).toBe(false);
      expect(isGradableResit(null, null)).toBe(false);
    });
  });
});

