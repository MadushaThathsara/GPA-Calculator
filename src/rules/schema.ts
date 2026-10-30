/**
 * rules/schema.ts
 *
 * TypeScript type definitions for a university configuration object.
 * One JSON file per university references this schema.
 *
 * Per spec §4 and §14.
 * NOTE: Values marked "PROVISIONAL" must be verified against the official
 * grading document before release (spec §12, open risk §10).
 */

// ─── Grade scale ──────────────────────────────────────────────────────────────

/** Letter grade as printed on result sheets. */
export type Grade =
  | 'A+'
  | 'A'
  | 'A-'
  | 'B+'
  | 'B'
  | 'B-'
  | 'C+'
  | 'C'
  | 'C-'
  | 'D'
  | 'E';

/** Canonical list of supported letter grades. */
export const VALID_GRADES: Grade[] = [
  'A+', 'A', 'A-',
  'B+', 'B', 'B-',
  'C+', 'C', 'C-',
  'D', 'E',
];

/** Maps each grade letter to its GPA point value. */
export type GradeScale = Record<Grade, number>;

// ─── Status codes ─────────────────────────────────────────────────────────────

/**
 * Status codes as printed on result sheets.
 * Compound statuses like "E(CA) & AB(ESA)" are split into parts by the
 * extraction pipeline (spec §5, M3).
 */
export type StatusCode =
  | 'E'
  | 'E(ESA)'
  | 'E(CA)'
  | 'AB'
  | 'AB(ESA)'
  | 'AB(CA)'
  | 'AB(CA) & AB(ESA)'
  | 'E(CA) & AB(ESA)'
  | 'N'
  | 'W';

/** Canonical list of supported result status codes. */
export const VALID_STATUSES: StatusCode[] = [
  'E',
  'E(ESA)',
  'E(CA)',
  'AB',
  'AB(ESA)',
  'AB(CA)',
  'AB(CA) & AB(ESA)',
  'E(CA) & AB(ESA)',
  'N',
  'W',
];

/** All valid grade and status values for user editing. */
export const ALL_VALID_GRADE_STATUS = [...VALID_GRADES, ...VALID_STATUSES];

/** Validates whether a given string is a valid grade or status. */
export function isValidGradeOrStatus(val: string): boolean {
  if (!val || typeof val !== 'string') return false;
  const trimmed = val.trim();
  return (ALL_VALID_GRADE_STATUS as string[]).includes(trimmed);
}

/** Whether a status contributes to GPA (counted at 0.0) or is excluded. */
export type StatusRule = {
  /** True → included in GPA as 0.0; false → excluded entirely. */
  inGpa: boolean;
};

// ─── Repeat / resit cap ───────────────────────────────────────────────────────

/**
 * Grades whose originals are eligible for the repeat/resit cap rule.
 * Spec §4 table: C-, D, E, E(CA), E(ESA) → cap at B when repeat is above B.
 */
export type CapEligibleOriginal = 'C-' | 'D' | 'E' | 'E(CA)' | 'E(ESA)';

/**
 * The capped grade applied when the repeat result exceeds the cap trigger.
 * Per spec §4: cap grade is B (3.0) — PROVISIONAL.
 */
export type CapGrade = Grade;

/** Repeat/resit cap configuration for a university. */
export type RepeatCapRule = {
  /**
   * Original grades that are eligible for the cap.
   * Defaults to spec §4 list: ['C-', 'D', 'E', 'E(CA)', 'E(ESA)'].
   */
  eligibleOriginals: CapEligibleOriginal[];
  /**
   * Repeat grades that trigger the cap (i.e. repeat is "above B").
   * Defaults to spec §4 list: ['B+', 'A-', 'A', 'A+'].
   */
  capTriggers: Grade[];
  /** The capped grade used for GPA when the cap applies. Default: 'B'. */
  capGrade: CapGrade;
};

// ─── Classification bands ─────────────────────────────────────────────────────

/** A single classification threshold. */
export type ClassificationBand = {
  label: string;
  /** Minimum CGPA (inclusive) for this classification. */
  minCgpa: number;
};

// ─── Module credit rule ───────────────────────────────────────────────────────

/**
 * How GPA credits are determined from module codes.
 * Per spec §4: credits = last digit of module code (e.g. IN3462 → 2).
 * Space normalization required: IIC 2242 → IIC2242 → 2.
 */
export type CreditRule = {
  /** Extract credits from the last digit of the normalized module code. */
  source: 'lastDigitOfCode';
};

// ─── Non-GPA module list ──────────────────────────────────────────────────────

/**
 * Module codes (or prefixes) that are never counted in GPA.
 * Per spec §2 and §4.
 */
export type NonGpaModuleList = string[];

// ─── University config root ───────────────────────────────────────────────────

/**
 * Complete configuration for one university.
 * One JSON file per university implements this interface.
 */
export interface UniversityConfig {
  /** Human-readable university name. */
  name: string;
  /** ISO 8601 date the config was last verified against official documents. */
  lastVerified: string | null;
  /** True while any values are unconfirmed against official sources. */
  provisional: boolean;

  /** Grade-to-point mapping. */
  gradeScale: GradeScale;

  /** Status rules: whether each status code counts in GPA. */
  statusRules: Record<StatusCode, StatusRule>;

  /** Repeat/resit cap rule. */
  repeatCap: RepeatCapRule;

  /** Classification bands, highest threshold first. */
  classificationBands: ClassificationBand[];

  /** Credit extraction rule. */
  creditRule: CreditRule;

  /** Module codes excluded from GPA regardless of grade. */
  nonGpaModules: NonGpaModuleList;

  /** Pattern used to validate index numbers (e.g. "ICT/yy/nnn"). */
  indexNumberPattern: string;
}
