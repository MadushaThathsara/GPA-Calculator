/**
 * extract/parseStatus.test.ts
 *
 * Vitest unit tests for M3 — status parser and index-number utilities.
 *
 * Tests cover:
 *  1. parseCellValue      — grades, simple statuses, compound statuses, unknowns.
 *  2. decomposeCompoundStatus — splits "E(CA) & AB(ESA)" etc.
 *  3. isValidIndexNumber  — validates ICT/yy/nnn pattern.
 *  4. normaliseIndexNumber — handles OCR / text-layer artifacts.
 */

import { describe, it, expect } from 'vitest';
import {
  parseCellValue,
  decomposeCompoundStatus,
  isValidIndexNumber,
  normaliseIndexNumber,
  type GradeLetter,
  type StatusToken,
} from './parseStatus';

// ---------------------------------------------------------------------------
// 1. parseCellValue — grade tokens
// ---------------------------------------------------------------------------

describe('parseCellValue — grades', () => {
  const grades: Array<[string, GradeLetter]> = [
    ['A+', 'A+'],
    ['A',  'A' ],
    ['A-', 'A-'],
    ['B+', 'B+'],
    ['B',  'B' ],
    ['B-', 'B-'],
    ['C+', 'C+'],
    ['C',  'C' ],
    ['C-', 'C-'],
    ['D',  'D' ],
    ['E',  'E' ],
  ];

  it.each(grades)('parses grade "%s"', (raw, expected) => {
    const result = parseCellValue(raw);
    expect(result.grade).toBe(expected);
    expect(result.statuses).toHaveLength(0);
    expect(result.unknown).toBe(false);
  });

  it('is whitespace-tolerant for grades', () => {
    expect(parseCellValue('  B+  ').grade).toBe('B+');
  });

  it('correctly handles "A-" (spec critical — text-layer may drop the minus)', () => {
    const result = parseCellValue('A-');
    expect(result.grade).toBe('A-');
    expect(result.unknown).toBe(false);
  });

  it('correctly handles "B-" (spec critical)', () => {
    const result = parseCellValue('B-');
    expect(result.grade).toBe('B-');
  });

  it('does not parse lower-case grades', () => {
    // Grade cells on result sheets are always uppercase
    const result = parseCellValue('a+');
    expect(result.grade).toBeNull();
    expect(result.unknown).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. parseCellValue — simple statuses
// ---------------------------------------------------------------------------

describe('parseCellValue — simple statuses', () => {
  const statuses: Array<[string, StatusToken]> = [
    ['E(CA)',   'E(CA)'  ],
    ['E(ESA)',  'E(ESA)' ],
    ['AB(CA)',  'AB(CA)' ],
    ['AB(ESA)', 'AB(ESA)'],
    ['N',       'N'      ],
    ['W',       'W'      ],
  ];

  it.each(statuses)('parses status "%s"', (raw, expected) => {
    const result = parseCellValue(raw);
    expect(result.grade).toBeNull();
    expect(result.statuses).toEqual([expected]);
    expect(result.unknown).toBe(false);
  });

  it('parses bare "AB" as an absence status', () => {
    const result = parseCellValue('AB');
    expect(result.grade).toBeNull();
    expect(result.statuses).toEqual(['AB']);
    expect(result.unknown).toBe(false);
  });

  it('is case-insensitive for statuses', () => {
    const result = parseCellValue('e(ca)');
    expect(result.statuses).toEqual(['E(CA)']);
  });
});

// ---------------------------------------------------------------------------
// 3. parseCellValue — compound statuses
// ---------------------------------------------------------------------------

describe('parseCellValue — compound statuses', () => {
  it('parses "E(CA) & AB(ESA)"', () => {
    const result = parseCellValue('E(CA) & AB(ESA)');
    expect(result.grade).toBeNull();
    expect(result.statuses).toEqual(['E(CA) & AB(ESA)']);
    expect(result.unknown).toBe(false);
  });

  it('parses "AB(CA) & AB(ESA)"', () => {
    const result = parseCellValue('AB(CA) & AB(ESA)');
    expect(result.statuses).toEqual(['AB(CA) & AB(ESA)']);
  });

  it('preserves the raw value', () => {
    const raw = 'E(CA) & AB(ESA)';
    expect(parseCellValue(raw).raw).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// 4. parseCellValue — unknown values
// ---------------------------------------------------------------------------

describe('parseCellValue — unknowns', () => {
  it('marks empty string as unknown', () => {
    const result = parseCellValue('');
    expect(result.unknown).toBe(true);
    expect(result.grade).toBeNull();
    expect(result.statuses).toHaveLength(0);
  });

  it('marks a random string as unknown', () => {
    expect(parseCellValue('XYZZY').unknown).toBe(true);
  });

  it('marks a partial status as unknown', () => {
    expect(parseCellValue('AB(').unknown).toBe(true);
  });

  it('marks a number as unknown', () => {
    expect(parseCellValue('42').unknown).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. decomposeCompoundStatus
// ---------------------------------------------------------------------------

describe('decomposeCompoundStatus', () => {
  it('decomposes "E(CA) & AB(ESA)" into two tokens', () => {
    const parts = decomposeCompoundStatus('E(CA) & AB(ESA)');
    expect(parts).toEqual(['E(CA)', 'AB(ESA)']);
  });

  it('decomposes "AB(CA) & AB(ESA)" into two tokens', () => {
    const parts = decomposeCompoundStatus('AB(CA) & AB(ESA)');
    expect(parts).toEqual(['AB(CA)', 'AB(ESA)']);
  });

  it('returns simple statuses unchanged as a single-element array', () => {
    expect(decomposeCompoundStatus('E(CA)')).toEqual(['E(CA)']);
    expect(decomposeCompoundStatus('N')).toEqual(['N']);
    expect(decomposeCompoundStatus('AB(ESA)')).toEqual(['AB(ESA)']);
  });
});

// ---------------------------------------------------------------------------
// 6. isValidIndexNumber
// ---------------------------------------------------------------------------

describe('isValidIndexNumber', () => {
  it('accepts a canonical index number', () => {
    expect(isValidIndexNumber('ICT/23/811')).toBe(true);
  });

  it('accepts edge-case digits', () => {
    expect(isValidIndexNumber('ICT/00/000')).toBe(true);
    expect(isValidIndexNumber('ICT/99/999')).toBe(true);
  });

  it('rejects missing slashes', () => {
    expect(isValidIndexNumber('ICT23811')).toBe(false);
  });

  it('rejects wrong case', () => {
    expect(isValidIndexNumber('ict/23/811')).toBe(false);
  });

  it('rejects extra digits in the year part', () => {
    expect(isValidIndexNumber('ICT/234/811')).toBe(false);
  });

  it('rejects extra digits in the sequence part', () => {
    expect(isValidIndexNumber('ICT/23/8110')).toBe(false);
  });

  it('accepts supported faculty prefixes', () => {
    expect(isValidIndexNumber('ITC/23/811')).toBe(true);
    expect(isValidIndexNumber('IT/23/811')).toBe(true);
    expect(isValidIndexNumber('CS/23/811')).toBe(true);
    expect(isValidIndexNumber('2021/ITC/045')).toBe(false); // wrong order for slash format without normalisation
    expect(isValidIndexNumber('UOM/23/811')).toBe(false); // unsupported prefix
  });

  it('rejects an empty string', () => {
    expect(isValidIndexNumber('')).toBe(false);
  });

  it('rejects a grade token', () => {
    expect(isValidIndexNumber('A-')).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    expect(isValidIndexNumber('  ICT/23/811  ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. normaliseIndexNumber (parseStatus version)
// ---------------------------------------------------------------------------

describe('normaliseIndexNumber (parseStatus)', () => {
  it('passes through canonical form', () => {
    expect(normaliseIndexNumber('ICT/23/811')).toBe('ICT/23/811');
  });

  it('fixes missing slashes', () => {
    expect(normaliseIndexNumber('ICT23811')).toBe('ICT/23/811');
  });

  it('fixes partial slash', () => {
    expect(normaliseIndexNumber('ICT23/811')).toBe('ICT/23/811');
  });

  it('fixes spaces', () => {
    expect(normaliseIndexNumber('ICT 23 811')).toBe('ICT/23/811');
  });

  it('up-cases the string', () => {
    expect(normaliseIndexNumber('ict/23/811')).toBe('ICT/23/811');
  });

  it('returns null for non-ICT tokens', () => {
    expect(normaliseIndexNumber('UOM/23/811')).toBeNull();
  });

  it('returns null for too few digits', () => {
    expect(normaliseIndexNumber('ICT/23/81')).toBeNull();
  });

  it('returns null for too many digits', () => {
    expect(normaliseIndexNumber('ICT/234/811')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normaliseIndexNumber('')).toBeNull();
  });
});
