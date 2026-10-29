/**
 * engine/credits.test.ts
 *
 * Unit tests for creditFromCode() — the credit extraction rule from spec §4.
 *
 * Examples from spec:
 *   IN3462 → 2
 *   IC3433 → 3
 *   IC3341 → 1
 *   IIC 2242 → 2 (space normalization)
 *
 * Edge cases:
 *   Codes ending in 0 → null (prompt manual entry)
 *   Empty string → null
 */
import { describe, it, expect } from 'vitest';
import { creditFromCode } from './credits';

describe('creditFromCode', () => {
  // ── Examples from spec §4 ──────────────────────────────────────────────────

  it('extracts last digit from IN3462 → 2', () => {
    expect(creditFromCode('IN3462')).toBe(2);
  });

  it('extracts last digit from IC3433 → 3', () => {
    expect(creditFromCode('IC3433')).toBe(3);
  });

  it('extracts last digit from IC3341 → 1', () => {
    expect(creditFromCode('IC3341')).toBe(1);
  });

  it('normalises space in IIC 2242 → 2', () => {
    expect(creditFromCode('IIC 2242')).toBe(2);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('returns null for a code ending in 0 (non-usable)', () => {
    expect(creditFromCode('IN3460')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(creditFromCode('')).toBeNull();
  });

  it('handles multiple spaces in module code', () => {
    expect(creditFromCode('IIC  22 42')).toBe(2);
  });

  it('handles lower-case codes', () => {
    expect(creditFromCode('in3462')).toBe(2);
  });

  it('returns the last digit even for a single-char code', () => {
    expect(creditFromCode('3')).toBe(3);
  });
});
