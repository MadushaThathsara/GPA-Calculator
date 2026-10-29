/**
 * extract/parseStatus.ts
 *
 * M3: Parse compound status strings into their component parts.
 *
 * Per spec §3/§5:
 *  "Parse compound statuses such as E(CA) & AB(ESA) into CA and ESA parts."
 *
 * Status strings found on result sheets:
 *   Simple:   "E", "E(ESA)", "E(CA)", "AB(ESA)", "AB(CA)", "N", "W"
 *   Compound: "E(CA) & AB(ESA)", "AB(CA) & AB(ESA)"
 *
 * Index-number pattern: ICT/yy/nnn  (per spec §5)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Known grade letters (letter grades from the scale). */
export type GradeLetter =
  | 'A+' | 'A' | 'A-'
  | 'B+' | 'B' | 'B-'
  | 'C+' | 'C' | 'C-'
  | 'D'
  | 'E';

/** Canonical status token as it appears on a result sheet or after normalisation. */
export type StatusToken =
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

/** Result of parsing a cell value (grade/status column). */
export interface ParsedCellValue {
  /** Normalised grade letter, or null if this cell holds a status. */
  grade: GradeLetter | null;
  /**
   * All status tokens found in the cell.
   * Simple statuses produce one entry; compound ones produce the full
   * normalised compound string as the single token.
   */
  statuses: StatusToken[];
  /**
   * The raw text that was parsed (for debugging and the "both readings" UI).
   */
  raw: string;
  /** True if the value could not be matched to any known grade or status. */
  unknown: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * All known grade letters, ordered longest-first so the regex prefers
 * "A-" over "A" and "B+" over "B".
 */
const GRADE_TOKENS: GradeLetter[] = [
  'A+', 'A-', 'A',
  'B+', 'B-', 'B',
  'C+', 'C-', 'C',
  'D',
  'E',
];

/**
 * All known single-status tokens (non-grade, non-compound).
 * NOTE: "E" also appears as a grade (0.0 points).  When "E" appears alone
 * in the grade column it is treated as a grade; when it appears in the
 * status column or alongside an AB token it is a status.  The caller
 * decides which column the cell belongs to.
 */
const SIMPLE_STATUS_TOKENS: StatusToken[] = [
  'E(CA) & AB(ESA)',  // compound – check first (most specific)
  'AB(CA) & AB(ESA)',
  'E(CA)',
  'E(ESA)',
  'AB(CA)',
  'AB(ESA)',
  'AB',
  'N',
  'W',
];

// Regex that matches a grade letter at the start of the string (after trim)
const GRADE_RE = new RegExp(
  `^(${GRADE_TOKENS.map((g) => g.replace('+', '\\+').replace('-', '\\-')).join('|')})\\s*$`,
);

// Regex that matches the index number pattern with supported faculty prefixes
export const INDEX_RE = /^(ICT|ITC|IT|IS|CS|SE|ET|BST|AT|FOT)\/(\d{2}|\d{4})\/(\d{3})$/;

// ---------------------------------------------------------------------------
// Primary parser
// ---------------------------------------------------------------------------

/**
 * Parses a raw cell string (from a grade or status column) into a
 * `ParsedCellValue`.
 *
 * Handles:
 *  - Grade letters: "A", "A+", "B-", etc. (including minus-sign variants)
 *  - Simple statuses: "E(CA)", "AB(ESA)", "N", "W", …
 *  - Compound statuses: "E(CA) & AB(ESA)", "AB(CA) & AB(ESA)"
 *  - Whitespace normalisation and case normalisation
 *
 * @param raw   The raw string from the cell (text layer or OCR).
 */
export function parseCellValue(raw: string): ParsedCellValue {
  // Normalize unicode dashes/minus signs to standard ASCII '-'
  let normalised = raw
    .trim()
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/\s{2,}/g, ' ');

  // Normalize spaces between grade letter and +/- (e.g. "A -" -> "A-", "B +" -> "B+")
  normalised = normalised.replace(/^([A-Da-d])\s*([+\-])\s*$/, '$1$2');

  // ── Check grade ──────────────────────────────────────────────────────────
  const gradeMatch = GRADE_RE.exec(normalised);
  if (gradeMatch) {
    return {
      grade: gradeMatch[1] as GradeLetter,
      statuses: [],
      raw,
      unknown: false,
    };
  }

  // ── Check compound / simple statuses ────────────────────────────────────
  for (const token of SIMPLE_STATUS_TOKENS) {
    // Case-insensitive match on the whole string
    if (normalised.toUpperCase() === token.toUpperCase()) {
      return {
        grade: null,
        statuses: [token],
        raw,
        unknown: false,
      };
    }
  }

  // ── Unknown ─────────────────────────────────────────────────────────────
  return { grade: null, statuses: [], raw, unknown: true };
}

// ---------------------------------------------------------------------------
// Compound status decomposition
// ---------------------------------------------------------------------------

/**
 * Decomposes a compound status string into its component parts.
 *
 * "E(CA) & AB(ESA)"  →  ['E(CA)', 'AB(ESA)']
 * "AB(CA) & AB(ESA)" →  ['AB(CA)', 'AB(ESA)']
 * "E(CA)"            →  ['E(CA)']
 * "N"                →  ['N']
 *
 * @returns Array of simple StatusToken parts (always at least 1 element).
 */
export function decomposeCompoundStatus(token: StatusToken): StatusToken[] {
  if (token === 'E(CA) & AB(ESA)') return ['E(CA)', 'AB(ESA)'];
  if (token === 'AB(CA) & AB(ESA)') return ['AB(CA)', 'AB(ESA)'];
  return [token];
}

// ---------------------------------------------------------------------------
// Index-number helpers
// ---------------------------------------------------------------------------

/**
 * Validates a (possibly normalised) index number against the
 * prefix/yy/nnn pattern (spec §5, supporting faculty prefixes).
 */
export function isValidIndexNumber(s: string): boolean {
  return INDEX_RE.test(s.trim());
}

/**
 * Attempts to normalise a raw index number token produced by OCR or the text
 * layer into the canonical "PREFIX/YY/NNN" form.
 */
export function normaliseIndexNumber(raw: string): string | null {
  if (!raw) return null;
  // Strip enclosing quotes, brackets, and extra punctuation
  let s = raw.trim().replace(/^[\([<{'"|\s]+/, '').replace(/[\)\]>}'"|.,;\s]+$/, '');
  s = s.toUpperCase().replace(/\s+/g, '');

  // Handle OCR misrecognition where leading 'I' in 'ICT' is read as '|', '1', '/', 'l', or dropped ('CT')
  s = s.replace(/^[|1\/L]CT/, 'ICT');
  if (/^CT\d{5}$/.test(s) || /^CT[\/\-_.]\d{2,4}[\/\-_.]\d{3}$/.test(s)) {
    s = 'I' + s;
  }

  // Matches supported PREFIX/YY/NNN with optional slashes, dashes, dots, or underscores
  const match = s.match(
    /^(ICT|ITC|IT|IS|CS|SE|ET|BST|AT|FOT)[\/\-_.]?(\d{2}|\d{4})[\/\-_.]?(\d{3,4})$/,
  );
  if (match) {
    const prefix = match[1];
    const yr = match[2].length === 4 ? match[2].slice(-2) : match[2];
    const num = match[3];
    return `${prefix}/${yr}/${num}`;
  }

  // Also match Year first formats: 2021/ITC/045 or 21/ITC/045
  const yrFirstMatch = s.match(
    /^(\d{2}|\d{4})[\/\-_.]?(ICT|ITC|IT|IS|CS|SE|ET|BST|AT|FOT)[\/\-_.]?(\d{3,4})$/,
  );
  if (yrFirstMatch) {
    const yr = yrFirstMatch[1].length === 4 ? yrFirstMatch[1].slice(-2) : yrFirstMatch[1];
    const prefix = yrFirstMatch[2];
    const num = yrFirstMatch[3];
    return `${prefix}/${yr}/${num}`;
  }

  return null;
}
