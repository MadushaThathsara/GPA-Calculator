/**
 * store/types.ts
 *
 * Types for the session state model (spec §7).
 * No marks are ever stored.
 */
import type { ExtractedSheet, ResultRow } from '../extract/types';

/** A single user edit to a result row (spec §6). */
export interface EditRecord {
  /** Identifies the sheet. */
  sheetDisplayName: string;
  /** Identifies the row within the sheet. */
  indexNumber: string;
  moduleCode: string;
  /** New grade or status value entered by the user. */
  newValue: string;
  /** Original working value before edit. */
  previousValue: string;
  editedAt: number; // Unix timestamp
}

/** A sheet loaded into the session. */
export interface SheetRecord {
  sheet: ExtractedSheet;
  /** Manual credit overrides: moduleCode → credits. */
  manualCredits: Record<string, number>;
  /** Per-module include/exclude overrides (spec A6). */
  moduleExclusions: Set<string>;
}

/** Top-level session state held in memory and persisted to sessionStorage. */
export interface SessionState {
  sheets: SheetRecord[];
  edits: EditRecord[];
  /** The active university config name. */
  universityConfigName: string;
}

/** A student's result for a single module, derived from session state. */
export interface StudentModuleResult {
  moduleCode: string;
  courseName: string;
  credits: number;
  /** Original extracted row. */
  row: ResultRow;
  /** Effective grade after applying repeat/resit rules. */
  effectiveGrade: string | null;
  gpaPoints: number | null;
  /** True when the result has been user-edited this session. */
  edited: boolean;
}
