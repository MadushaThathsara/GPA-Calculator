/**
 * rules/validator.ts
 *
 * Runtime validation of university config objects loaded from JSON.
 * Throws descriptive errors so misconfigured files fail loudly at startup.
 */
import type { UniversityConfig } from './schema';

const REQUIRED_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'E'] as const;
const REQUIRED_STATUSES = [
  'E(ESA)',
  'E(CA)',
  'AB',
  'AB(ESA)',
  'AB(CA)',
  'AB(CA) & AB(ESA)',
  'E(CA) & AB(ESA)',
  'N',
  'W',
] as const;

/**
 * Validates a university config object.
 * @throws {Error} with a descriptive message when validation fails.
 */
export function validateConfig(config: unknown): asserts config is UniversityConfig {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Config must be a non-null object');
  }

  const c = config as Record<string, unknown>;

  if (typeof c['name'] !== 'string' || c['name'].length === 0) {
    throw new Error('Config.name must be a non-empty string');
  }

  // Grade scale
  if (typeof c['gradeScale'] !== 'object' || c['gradeScale'] === null) {
    throw new Error('Config.gradeScale must be an object');
  }
  const gs = c['gradeScale'] as Record<string, unknown>;
  for (const grade of REQUIRED_GRADES) {
    if (typeof gs[grade] !== 'number') {
      throw new Error(`Config.gradeScale["${grade}"] must be a number`);
    }
  }

  // Status rules
  if (typeof c['statusRules'] !== 'object' || c['statusRules'] === null) {
    throw new Error('Config.statusRules must be an object');
  }
  const sr = c['statusRules'] as Record<string, unknown>;
  for (const status of REQUIRED_STATUSES) {
    const rule = sr[status] as Record<string, unknown> | undefined;
    if (typeof rule?.['inGpa'] !== 'boolean') {
      throw new Error(`Config.statusRules["${status}"].inGpa must be a boolean`);
    }
  }

  // Classification bands
  if (!Array.isArray(c['classificationBands']) || c['classificationBands'].length === 0) {
    throw new Error('Config.classificationBands must be a non-empty array');
  }
  for (const band of c['classificationBands'] as unknown[]) {
    const b = band as Record<string, unknown>;
    if (typeof b['label'] !== 'string' || typeof b['minCgpa'] !== 'number') {
      throw new Error('Each classificationBand must have a string label and number minCgpa');
    }
  }

  // Repeat cap
  if (typeof c['repeatCap'] !== 'object' || c['repeatCap'] === null) {
    throw new Error('Config.repeatCap must be an object');
  }

  // Credit rule
  const cr = c['creditRule'] as Record<string, unknown> | undefined;
  if (cr?.['source'] !== 'lastDigitOfCode') {
    throw new Error('Config.creditRule.source must be "lastDigitOfCode"');
  }
}
