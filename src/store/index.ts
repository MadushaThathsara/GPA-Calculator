/**
 * store/index.ts
 *
 * Entry point for the session store.
 *
 * Per spec §14: "store/ holds the session model (sheets, rows, edits)
 * and tab-storage persistence."
 *
 * Per spec assumption A7: extracted rows are kept in browser tab storage
 * so a refresh doesn't force reprocessing. Uploaded PDF files are held
 * in memory only.
 *
 * Implemented in M4 and M6.
 */

export type { SessionState, SheetRecord, EditRecord } from './types';
export { useSessionStore } from './useSessionStore';
export type { MockSheet, MockResultRow, SemesterResult, StudentSearchResult } from './useSessionStore';
