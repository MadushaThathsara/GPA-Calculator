/**
 * rules/validator.test.ts
 *
 * Unit tests for the university config validator.
 * Verifies that invalid configs throw descriptive errors and the UoC config passes.
 */
import { describe, it, expect } from 'vitest';
import { validateConfig } from './validator';
import uocConfig from './universities/uoc';

describe('validateConfig', () => {
  it('passes for the UoC provisional config without throwing', () => {
    expect(() => validateConfig(uocConfig)).not.toThrow();
  });

  it('throws when config is null', () => {
    expect(() => validateConfig(null)).toThrow('non-null object');
  });

  it('throws when name is missing', () => {
    expect(() => validateConfig({})).toThrow('name');
  });

  it('throws when gradeScale is missing a required grade', () => {
    const partial = {
      name: 'Test University',
      gradeScale: { 'A': 4.0 }, // missing other grades
      statusRules: {},
      classificationBands: [{ label: 'Pass', minCgpa: 2.0 }],
      repeatCap: {},
      creditRule: { source: 'lastDigitOfCode' },
      nonGpaModules: [],
    };
    expect(() => validateConfig(partial)).toThrow('gradeScale');
  });

  it('throws when creditRule source is wrong', () => {
    const config = {
      ...uocConfig,
      creditRule: { source: 'manual' },
    };
    expect(() => validateConfig(config)).toThrow('lastDigitOfCode');
  });

  it('throws when classificationBands is empty', () => {
    const config = { ...uocConfig, classificationBands: [] };
    expect(() => validateConfig(config)).toThrow('classificationBands');
  });
});
