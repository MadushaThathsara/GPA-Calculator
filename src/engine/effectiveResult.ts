/**
 * engine/effectiveResult.ts
 *
 * Determines the effective grade used for GPA from an original result and an
 * optional repeat/resit result, applying the full repeat/resit table from spec §4.
 *
 * Full table (to be unit-tested exhaustively in M1):
 *
 * | Original result              | Repeat result              | Used for GPA            |
 * |------------------------------|----------------------------|-------------------------|
 * | C-, D, E, E(CA), E(ESA)      | Above B (B+, A-, A, A+)    | B (3.0), cap applied    |
 * | C-, D, E, E(CA), E(ESA)      | B or lower (including E)   | Actual repeat grade     |
 * | AB, AB(CA) & AB(ESA), etc.   | Any grade                  | Full repeat grade, no cap|
 * | B, B+, A-, A, A+             | Any                        | Original kept           |
 * | C+, C                        | Any                        | Original kept           |
 * | N, W                         | Any                        | Stays displayed, excluded|
 * | Any                          | Repeat grade is AB         | Original unchanged      |
 *
 * Additional rules (spec §4):
 * - A lower repeat still replaces an eligible original (C- → repeat D gives D).
 * - The capped grade affects only the GPA value; sheet shows actual repeat grade.
 */
import type { Grade, UniversityConfig } from '../rules/schema';

export type EffectiveResultInput = {
  originalGrade: Grade | null;
  originalStatus: string | null;
  repeatGrade: Grade | null;
  repeatStatus: string | null;
  config: UniversityConfig;
};

export type EffectiveResult = {
  /** The grade used in GPA calculation. Null when excluded. */
  gpaGrade: Grade | null;
  /** True when the GPA grade has been capped (≠ actual repeat grade). */
  capped: boolean;
  /** True when this result is excluded from GPA entirely. */
  excluded: boolean;
  /** Explanation note for the UI. */
  note: string;
};

// AB-type statuses that allow a full (uncapped) repeat grade
const AB_TYPE_STATUSES = new Set([
  'AB',
  'AB(ESA)',
  'AB(CA)',
  'AB(CA) & AB(ESA)',
  'E(CA) & AB(ESA)',
]);

// Statuses that leave the original unchanged regardless of repeat
const NEUTRAL_ORIGINAL_STATUSES = new Set(['N', 'W']);

// AB and neutral statuses in the repeat slot → original is unchanged (spec §4 & Assumption A4)
const AB_REPEAT_STATUSES = new Set([
  'AB',
  'AB(ESA)',
  'AB(CA)',
  'AB(CA) & AB(ESA)',
  'E(CA) & AB(ESA)',
]);
const NEUTRAL_REPEAT_STATUSES = new Set(['N', 'W']);

/**
 * Checks whether a repeat attempt is gradable (has a letter grade or in-GPA fail status).
 * Ungradable results (AB, N, W) must not overwrite earlier gradable resits (spec Assumption A3).
 */
export function isGradableResit(grade: string | null, status: string | null): boolean {
  if (grade !== null) return true;
  if (status !== null) {
    if (AB_REPEAT_STATUSES.has(status) || NEUTRAL_REPEAT_STATUSES.has(status)) {
      return false;
    }
    // E-type failure statuses are gradable (count as 0.0)
    return status === 'E' || status === 'E(ESA)' || status === 'E(CA)';
  }
  return false;
}

/**
 * Computes the effective result for one student's module.
 * Pure function — no side effects, no I/O.
 */
export function effectiveResult(input: EffectiveResultInput): EffectiveResult {
  const { originalGrade, originalStatus, repeatGrade, repeatStatus, config } = input;
  const { repeatCap, statusRules } = config;

  // ── If no repeat exists, use the original ──────────────────────────────────
  if (repeatGrade === null && repeatStatus === null) {
    return resolveOriginalOnly(originalGrade, originalStatus, statusRules);
  }

  // ── If the repeat result is AB, N, or W → original unchanged (spec §4 & A4) ──
  if (
    repeatStatus !== null &&
    (AB_REPEAT_STATUSES.has(repeatStatus) || NEUTRAL_REPEAT_STATUSES.has(repeatStatus))
  ) {
    return resolveOriginalOnly(originalGrade, originalStatus, statusRules);
  }

  // ── If the original is N or W → stays displayed and excluded ──────────────
  if (originalStatus !== null && NEUTRAL_ORIGINAL_STATUSES.has(originalStatus)) {
    return {
      gpaGrade: null,
      capped: false,
      excluded: true,
      note: `Original ${originalStatus} — excluded; repeat ignored`,
    };
  }

  // ── If the original is AB-type → full repeat grade, no cap ────────────────
  if (originalStatus !== null && AB_TYPE_STATUSES.has(originalStatus)) {
    if (repeatGrade !== null) {
      return {
        gpaGrade: repeatGrade,
        capped: false,
        excluded: false,
        note: 'AB-type original: full repeat grade, no cap',
      };
    }
    // repeat is a non-AB status (e.g. E(CA)) — treat as 0.0 in GPA if inGpa
    return resolveRepeatStatus(repeatStatus, statusRules);
  }

  // ── Originals of B or higher and C+/C → original kept ────────────────────
  const keptOriginals: Array<Grade> = ['B', 'B+', 'A-', 'A', 'A+', 'C+', 'C'];
  if (originalGrade !== null && keptOriginals.includes(originalGrade)) {
    return resolveOriginalOnly(originalGrade, originalStatus, statusRules);
  }

  // ── Cap-eligible originals (C-, D, E, E(CA), E(ESA)) ─────────────────────
  const eligibleOriginal =
    (originalGrade !== null && (repeatCap.eligibleOriginals as string[]).includes(originalGrade)) ||
    (originalStatus !== null && (repeatCap.eligibleOriginals as string[]).includes(originalStatus));

  if (eligibleOriginal) {
    // If repeat is a letter grade:
    if (repeatGrade !== null) {
      const triggersCap = (repeatCap.capTriggers as string[]).includes(repeatGrade);
      if (triggersCap) {
        return {
          gpaGrade: repeatCap.capGrade,
          capped: true,
          excluded: false,
          note: `Repeat ${repeatGrade} capped at ${repeatCap.capGrade} for GPA`,
        };
      }
      // Repeat is B or lower — use actual repeat grade (even if lower than original)
      return {
        gpaGrade: repeatGrade,
        capped: false,
        excluded: false,
        note: 'Actual repeat grade used',
      };
    }

    // If repeat is a status (e.g. E(ESA), E(CA), E):
    if (repeatStatus !== null) {
      const rule = statusRules[repeatStatus as keyof typeof statusRules];
      if (rule?.inGpa) {
        return {
          gpaGrade: 'E',
          capped: false,
          excluded: false,
          note: `Repeat ${repeatStatus} counted as E (0.0)`,
        };
      }
      return {
        gpaGrade: null,
        capped: false,
        excluded: true,
        note: `Repeat ${repeatStatus} excluded from GPA`,
      };
    }
  }

  // Fallback: use original
  return resolveOriginalOnly(originalGrade, originalStatus, statusRules);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveOriginalOnly(
  grade: Grade | null,
  status: string | null,
  statusRules: UniversityConfig['statusRules'],
): EffectiveResult {
  if (grade !== null) {
    return { gpaGrade: grade, capped: false, excluded: false, note: '' };
  }
  if (status !== null) {
    const rule = statusRules[status as keyof typeof statusRules];
    if (rule?.inGpa) {
      return { gpaGrade: 'E', capped: false, excluded: false, note: `${status} counted as E (0.0)` };
    }
    return { gpaGrade: null, capped: false, excluded: true, note: `${status} excluded from GPA` };
  }
  return { gpaGrade: null, capped: false, excluded: true, note: 'No grade or status' };
}

function resolveRepeatStatus(
  repeatStatus: string | null,
  statusRules: UniversityConfig['statusRules'],
): EffectiveResult {
  if (repeatStatus !== null) {
    const rule = statusRules[repeatStatus as keyof typeof statusRules];
    if (rule?.inGpa) {
      return { gpaGrade: 'E', capped: false, excluded: false, note: `Repeat ${repeatStatus} counted as E (0.0)` };
    }
    return { gpaGrade: null, capped: false, excluded: true, note: `Repeat ${repeatStatus} excluded from GPA` };
  }
  return { gpaGrade: null, capped: false, excluded: true, note: 'No repeat grade' };
}
