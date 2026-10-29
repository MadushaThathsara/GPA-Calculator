/**
 * store/useSessionStore.ts
 *
 * React state hook and pure computation engine for the session data model (spec §7, §14, §15 M4/M5).
 *
 * Holds uploaded sheets and their parsed result rows in memory.
 * Persists to sessionStorage (spec A7) so a refresh doesn't force re-upload.
 *
 * Handles:
 *  - Sheet add / replace / remove
 *  - Duplicate course detection (spec §3 flow 2, §15 M4)
 *  - Repeat / resit linking and GPA recalculation (spec §4, §15 M4)
 *  - Manual credit entry (spec §3 flow 5, §15 M5)
 *  - Per-module include/exclude toggle (spec A6, §15 M5)
 *  - Exam session assignment / editing (spec §2, §15 M4)
 *  - Index-number search with robust normalization (spec §5, §15 M5)
 */

import { useState, useCallback, useEffect } from 'react';
import type { UniversityConfig } from '../rules/schema';
import { creditFromCode } from '../engine/credits';
import { gradePoints } from '../engine/gradePoints';
import { effectiveResult, isGradableResit } from '../engine/effectiveResult';
import { calculateSgpa, calculateCgpa } from '../engine/gpa';
import { classify } from '../engine/classification';
import type { Grade } from '../rules/schema';
import { extractAcademicYear, parseSemesterHeading } from '../extract/pdfText';

// ---------------------------------------------------------------------------
// In-Memory Data Models
// ---------------------------------------------------------------------------

export interface MockResultRow {
  indexNumber: string;
  moduleCode: string;
  grade: string | null;
  status: string | null;
  flags: Array<'ocr' | 'check-this' | 'edited'>;
  textReading: string | null;
  ocrReading: string | null;
  workingValue: string;
}

export interface MockSheet {
  id: string;
  fileName: string;
  displayName: string;
  courseCode: string;
  courseName: string;
  academicYear?: number | null;
  semesterNumber?: number | null;
  examYear?: string | null;
  examSession: string | null;
  type?: 'original' | 'repeat-resit';
  rows: MockResultRow[];
  semesterWarning?: string | null;
  academicYearWarning?: string | null;
  printedTotal?: number | null;
  countMismatchWarning?: string | null;
}

export interface ResitDetail {
  originalGrade: string | null;
  originalStatus: string | null;
  repeatGrade: string | null;
  repeatStatus: string | null;
  capped: boolean;
  note: string;
  noOriginalFound?: boolean;
}

export interface SemesterRowItem {
  row: MockResultRow;
  courseName: string;
  sheetId: string;
  sheetDisplayName: string;
  academicYear?: number | null;
  credits: number;
  manualCreditApplied: boolean;
  gpaPoints: number | null;
  effectiveGrade: string | null;
  excluded: boolean;
  isUserExcluded: boolean;
  resitInfo?: ResitDetail;
}

/** One semester's aggregated results for a specific student. */
export interface SemesterResult {
  sheet?: MockSheet;
  sheets: MockSheet[];
  semesterName: string;
  isUnassigned?: boolean;
  rows: SemesterRowItem[];
  sgpa: number;
  moduleCount: number;
  totalCredits: number;
}

/** Full search result for a student. */
export interface StudentSearchResult {
  indexNumber: string;
  semesters: SemesterResult[];
  cgpa: number;
  cgpaModuleCount: number;
  cgpaTotalCredits: number;
  classification: string | null;
}

const STORAGE_KEY = 'gpa_calc_session_sheets_v2';
const MANUAL_CREDITS_KEY = 'gpa_calc_session_credits_v2';
const EXCLUSIONS_KEY = 'gpa_calc_session_exclusions_v2';

// ---------------------------------------------------------------------------
// Pure Helpers
// ---------------------------------------------------------------------------

/** Standardize search queries and index numbers for match comparison */
export function normalizeIndex(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Pure calculation function: searches for a student across all sheets,
 * applies repeat/resit rules, credit overrides, and exclusions,
 * then returns SGPA, CGPA, and degree classification.
 */
export function calculateStudentSearch(
  sheets: MockSheet[],
  rawQuery: string,
  config: UniversityConfig,
  manualCredits: Record<string, number> = {},
  userExclusions: Record<string, boolean> = {},
): StudentSearchResult | null {
  const q = normalizeIndex(rawQuery);
  if (!q) return null;

  const originalSheets = sheets.filter((s) => s.type !== 'repeat-resit');
  const repeatSheets = sheets.filter((s) => s.type === 'repeat-resit');

  // Map to find repeat rows for this student: key = courseCode
  // Multi-resit handling (spec Assumption A3):
  // Collect all repeat entries for each course code, then select the latest gradable one.
  // Ungradable results (AB, N, W) must never overwrite a previously valid gradable resit.
  const repeatCandidates = new Map<string, Array<{ sheet: MockSheet; row: MockResultRow; order: number }>>();
  repeatSheets.forEach((rSheet, order) => {
    for (const row of rSheet.rows) {
      if (normalizeIndex(row.indexNumber).includes(q)) {
        const code = rSheet.courseCode.toUpperCase();
        if (!repeatCandidates.has(code)) {
          repeatCandidates.set(code, []);
        }
        repeatCandidates.get(code)!.push({ sheet: rSheet, row, order });
      }
    }
  });

  const studentRepeatRows = new Map<string, MockResultRow>();
  for (const [code, candidates] of repeatCandidates.entries()) {
    // Gradable candidates have a letter grade or in-GPA fail status
    const gradable = candidates.filter((c) => isGradableResit(c.row.grade, c.row.status));
    const pool = gradable.length > 0 ? gradable : candidates;
    // Sort pool by order descending (latest upload)
    pool.sort((a, b) => b.order - a.order);
    studentRepeatRows.set(code, pool[0].row);
  }

  // Group original sheets by semester session (spec §2, §4, §15 M4)
  const semesterGroups = new Map<string, { semesterName: string; isUnassigned: boolean; sheets: MockSheet[] }>();

  for (const sheet of originalSheets) {
    const rawSession = sheet.examSession?.trim();
    const isUnassigned = !rawSession;
    const key = isUnassigned ? '__UNASSIGNED__' : rawSession.toUpperCase();
    const displayName = isUnassigned ? 'Semester Unassigned' : rawSession!;

    if (!semesterGroups.has(key)) {
      semesterGroups.set(key, { semesterName: displayName, isUnassigned, sheets: [] });
    }
    semesterGroups.get(key)!.sheets.push(sheet);
  }

  const semesters: SemesterResult[] = [];
  let foundIndexNumber: string | null = null;

  // Process grouped semesters
  for (const group of semesterGroups.values()) {
    const semesterRowItems: SemesterRowItem[] = [];

    for (const sheet of group.sheets) {
      const matchingRows = sheet.rows.filter((r) => {
        const norm = normalizeIndex(r.indexNumber);
        return norm.includes(q);
      });

      if (matchingRows.length === 0) continue;

      if (!foundIndexNumber && matchingRows[0]) {
        foundIndexNumber = matchingRows[0].indexNumber;
      }

      for (const row of matchingRows) {
        const modCode = row.moduleCode.toUpperCase();
        const manualCr = manualCredits[modCode];
        const inferredCr = creditFromCode(row.moduleCode);
        const credits = manualCr !== undefined ? manualCr : (inferredCr ?? 0);
        const manualCreditApplied = manualCr !== undefined;

        // Check for repeat result
        const repeatRow = studentRepeatRows.get(modCode);
        let resitInfo: ResitDetail | undefined;
        let effective;

        if (repeatRow) {
          effective = effectiveResult({
            originalGrade: row.grade as Grade | null,
            originalStatus: row.status,
            repeatGrade: repeatRow.grade as Grade | null,
            repeatStatus: repeatRow.status,
            config,
          });
          resitInfo = {
            originalGrade: row.grade,
            originalStatus: row.status,
            repeatGrade: repeatRow.grade,
            repeatStatus: repeatRow.status,
            capped: effective.capped,
            note: effective.note,
          };
        } else {
          effective = effectiveResult({
            originalGrade: row.grade as Grade | null,
            originalStatus: row.status,
            repeatGrade: null,
            repeatStatus: null,
            config,
          });
        }

        // Check user exclusion
        const exclusionKey = `${normalizeIndex(row.indexNumber)}:${modCode}`;
        const isUserExcluded = !!userExclusions[exclusionKey];
        const excluded = effective.excluded || isUserExcluded;

        const gpaGrade = effective.gpaGrade;
        const gpaPointsVal =
          excluded || gpaGrade === null
            ? null
            : gradePoints(gpaGrade, config.gradeScale);

        semesterRowItems.push({
          row,
          courseName: sheet.courseName,
          sheetId: sheet.id,
          sheetDisplayName: sheet.displayName,
          academicYear: sheet.academicYear ?? extractAcademicYear(sheet.courseCode),
          credits,
          manualCreditApplied,
          gpaPoints: gpaPointsVal,
          effectiveGrade: gpaGrade,
          excluded,
          isUserExcluded,
          resitInfo,
        });
      }
    }

    if (semesterRowItems.length === 0) continue;

    const gpaInputs = semesterRowItems.map((d) => ({
      gpaGrade: d.excluded ? null : (d.effectiveGrade as Grade | null),
      credits: d.credits,
    }));

    const { gpa: sgpa, moduleCount, totalCredits } = calculateSgpa(
      gpaInputs,
      config.gradeScale,
    );

    semesters.push({
      sheet: group.sheets[0],
      sheets: group.sheets,
      semesterName: group.semesterName,
      isUnassigned: group.isUnassigned,
      rows: semesterRowItems,
      sgpa,
      moduleCount,
      totalCredits,
    });
  }

  // Handle students appearing only on repeat sheets (spec Assumption A2)
  for (const rSheet of repeatSheets) {
    const modCode = rSheet.courseCode.toUpperCase();
    const alreadyCovered = originalSheets.some((s) => s.courseCode.toUpperCase() === modCode);
    if (!alreadyCovered) {
      const matchingRepeatRows = rSheet.rows.filter((r) =>
        normalizeIndex(r.indexNumber).includes(q),
      );
      if (matchingRepeatRows.length > 0) {
        if (!foundIndexNumber && matchingRepeatRows[0]) {
          foundIndexNumber = matchingRepeatRows[0].indexNumber;
        }
        const rowItems: SemesterRowItem[] = matchingRepeatRows.map((r) => {
          const manualCr = manualCredits[modCode];
          const inferredCr = creditFromCode(r.moduleCode);
          const credits = manualCr !== undefined ? manualCr : (inferredCr ?? 0);
          const exclusionKey = `${normalizeIndex(r.indexNumber)}:${modCode}`;
          const isUserExcluded = !!userExclusions[exclusionKey];

          const effective = effectiveResult({
            originalGrade: null,
            originalStatus: null,
            repeatGrade: r.grade as Grade | null,
            repeatStatus: r.status,
            config,
          });

          const excluded = effective.excluded || isUserExcluded;
          const gpaGrade = effective.gpaGrade;
          const gpaPointsVal =
            excluded || gpaGrade === null
              ? null
              : gradePoints(gpaGrade, config.gradeScale);

          return {
            row: r,
            courseName: rSheet.courseName,
            sheetId: rSheet.id,
            sheetDisplayName: rSheet.displayName,
            credits,
            manualCreditApplied: manualCr !== undefined,
            gpaPoints: gpaPointsVal,
            effectiveGrade: gpaGrade,
            excluded,
            isUserExcluded,
            resitInfo: {
              originalGrade: null,
              originalStatus: null,
              repeatGrade: r.grade,
              repeatStatus: r.status,
              capped: false,
              note: 'No original sheet found — counts in resit session (spec A2)',
              noOriginalFound: true,
            },
          };
        });

        const gpaInputs = rowItems.map((d) => ({
          gpaGrade: d.excluded ? null : (d.effectiveGrade as Grade | null),
          credits: d.credits,
        }));
        const { gpa: sgpa, moduleCount, totalCredits } = calculateSgpa(
          gpaInputs,
          config.gradeScale,
        );

        semesters.push({
          sheet: rSheet,
          sheets: [rSheet],
          semesterName: rSheet.examSession ?? 'Resit session',
          isUnassigned: !rSheet.examSession,
          rows: rowItems,
          sgpa,
          moduleCount,
          totalCredits,
        });
      }
    }
  }

  if (semesters.length === 0) return null;

  // Compute overall CGPA across all active semesters
  const allGpaInputs = semesters.flatMap((s) =>
    s.rows.map((d) => ({
      gpaGrade: d.excluded ? null : (d.effectiveGrade as Grade | null),
      credits: d.credits,
    })),
  );

  const {
    gpa: cgpa,
    moduleCount: cgpaModuleCount,
    totalCredits: cgpaTotalCredits,
  } = calculateCgpa(allGpaInputs, config.gradeScale);

  const classification = classify(cgpa, config.classificationBands);

  return {
    indexNumber: foundIndexNumber ?? rawQuery,
    semesters,
    cgpa,
    cgpaModuleCount,
    cgpaTotalCredits,
    classification,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessionStore(config: UniversityConfig) {
  // Clean up legacy v1 storage if present so old duplicate state is wiped
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem('gpa_calc_session_sheets_v1');
      sessionStorage.removeItem('gpa_calc_session_credits_v1');
      sessionStorage.removeItem('gpa_calc_session_exclusions_v1');
    } catch {
      // Ignore
    }
  }

  // Load initial state safely from sessionStorage
  const [sheets, setSheets] = useState<MockSheet[]>(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        return saved ? JSON.parse(saved) : [];
      }
      return [];
    } catch {
      return [];
    }
  });

  const [manualCredits, setManualCredits] = useState<Record<string, number>>(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const saved = sessionStorage.getItem(MANUAL_CREDITS_KEY);
        return saved ? JSON.parse(saved) : {};
      }
      return {};
    } catch {
      return {};
    }
  });

  const [userExclusions, setUserExclusions] = useState<Record<string, boolean>>(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const saved = sessionStorage.getItem(EXCLUSIONS_KEY);
        return saved ? JSON.parse(saved) : {};
      }
      return {};
    } catch {
      return {};
    }
  });

  // Sync to sessionStorage
  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sheets));
      }
    } catch {
      // Ignore quota errors
    }
  }, [sheets]);

  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(MANUAL_CREDITS_KEY, JSON.stringify(manualCredits));
      }
    } catch {
      // Ignore quota errors
    }
  }, [manualCredits]);

  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(EXCLUSIONS_KEY, JSON.stringify(userExclusions));
      }
    } catch {
      // Ignore quota errors
    }
  }, [userExclusions]);

  /** Check if a course code is already loaded in the session (M4 duplicate check) */
  const checkDuplicate = useCallback(
    (courseCode: string, type?: 'original' | 'repeat-resit'): MockSheet | undefined => {
      const cleanCode = courseCode.trim().toUpperCase();
      return sheets.find(
        (s) =>
          s.courseCode.trim().toUpperCase() === cleanCode &&
          (type ? (s.type ?? 'original') === type : true),
      );
    },
    [sheets],
  );

  /** Add a new sheet with guaranteed unique ID */
  const addSheet = useCallback((sheet: MockSheet, asRepeatResit = false) => {
    const uniqueId = `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const prepared: MockSheet = {
      ...sheet,
      id: uniqueId,
      type: asRepeatResit ? 'repeat-resit' : (sheet.type ?? 'original'),
    };
    setSheets((prev) => [...prev, prepared]);
  }, []);

  /** Replace an existing sheet (spec §3 flow 2: Replace swaps the old sheet for new one) */
  const replaceSheet = useCallback((existingId: string, newSheet: MockSheet) => {
    setSheets((prev) => prev.map((s) => (s.id === existingId ? { ...newSheet, id: existingId } : s)));
  }, []);

  /** Remove a sheet by id */
  const removeSheet = useCallback((id: string) => {
    setSheets((prev) => prev.filter((s) => s.id !== id));
  }, []);

  /** Clear entire session */
  const clearSession = useCallback(() => {
    setSheets([]);
    setManualCredits({});
    setUserExclusions({});
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(MANUAL_CREDITS_KEY);
        sessionStorage.removeItem(EXCLUSIONS_KEY);
      }
    } catch {
      // Ignore
    }
  }, []);

  /** Set manual credits for a module (spec §3 flow 5, M5) */
  const setManualCredit = useCallback((moduleCode: string, credits: number) => {
    setManualCredits((prev) => ({
      ...prev,
      [moduleCode.toUpperCase()]: Math.max(0, credits),
    }));
  }, []);

  /** Toggle user exclusion for a student's module (spec A6, M5) */
  const toggleModuleExclusion = useCallback((indexNumber: string, moduleCode: string) => {
    const key = `${normalizeIndex(indexNumber)}:${moduleCode.toUpperCase()}`;
    setUserExclusions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  /** Update exam session name manually (spec §2, M4) */
  const updateExamSession = useCallback((sheetId: string, rawSession: string) => {
    const trimmed = rawSession.trim();
    const heading = trimmed ? parseSemesterHeading(trimmed) : null;
    setSheets((prev) =>
      prev.map((s) => {
        if (s.id !== sheetId) return s;
        return {
          ...s,
          examSession: trimmed || null,
          semesterNumber: heading?.semesterNumber ?? s.semesterNumber ?? null,
          examYear: heading?.examYear ?? s.examYear ?? null,
          semesterWarning: trimmed ? null : s.semesterWarning,
        };
      }),
    );
  }, []);

  /** Update academic year manually */
  const updateAcademicYear = useCallback((sheetId: string, academicYear: number | null) => {
    setSheets((prev) =>
      prev.map((s) => {
        if (s.id !== sheetId) return s;
        return {
          ...s,
          academicYear,
          academicYearWarning: academicYear !== null ? null : s.academicYearWarning,
        };
      }),
    );
  }, []);

  /** List of all distinct index numbers across all loaded sheets */
  const availableIndexNumbers = useCallback((): string[] => {
    const set = new Set<string>();
    for (const sheet of sheets) {
      for (const row of sheet.rows) {
        if (row.indexNumber) set.add(row.indexNumber);
      }
    }
    return Array.from(set).sort();
  }, [sheets]);

  /** Search by index number */
  const searchStudent = useCallback(
    (rawQuery: string): StudentSearchResult | null => {
      return calculateStudentSearch(sheets, rawQuery, config, manualCredits, userExclusions);
    },
    [sheets, manualCredits, userExclusions, config],
  );

  return {
    sheets,
    addSheet,
    replaceSheet,
    removeSheet,
    clearSession,
    checkDuplicate,
    setManualCredit,
    toggleModuleExclusion,
    updateExamSession,
    updateAcademicYear,
    availableIndexNumbers,
    searchStudent,
  };
}
