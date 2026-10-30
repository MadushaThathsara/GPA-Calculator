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
import { calculateSgpa, calculateCgpa, type GpaInput } from '../engine/gpa';
import { classify } from '../engine/classification';
import type { Grade } from '../rules/schema';
import { isValidGradeOrStatus } from '../rules/schema';
import { parseCellValue } from '../extract/parseStatus';
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
  originalGrade?: string | null;
  originalStatus?: string | null;
  editedValue?: string | null;
  isEdited?: boolean;
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
  totalCourseCredits: number;
  totalModules: number;
  hasGpa?: boolean;
}

/** Full search result for a student. */
export interface StudentSearchResult {
  indexNumber: string;
  semesters: SemesterResult[];
  cgpa: number;
  cgpaModuleCount: number;
  cgpaTotalCredits: number;
  totalCourseCredits: number;
  totalModules: number;
  classification: string | null;
  hasCgpa?: boolean;
}

const STORAGE_KEY = 'gpa_calc_session_sheets_v2';
const MANUAL_CREDITS_KEY = 'gpa_calc_session_credits_v2';
const EXCLUSIONS_KEY = 'gpa_calc_session_exclusions_v2';
const MODULE_EXCLUSIONS_KEY = 'gpa_calc_session_module_exclusions_v2';
const EDITS_KEY = 'gpa_calc_session_edits_v2';

// ---------------------------------------------------------------------------
// Pure Helpers
// ---------------------------------------------------------------------------

/** Standardize search queries and index numbers for match comparison */
export function normalizeIndex(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Normalize module codes for consistent exclusion and mapping (e.g. "IIC 1123" -> "IIC1123") */
export function normalizeModuleCode(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, '');
}

/**
 * Calculates total course credits and total modules across loaded sheets.
 * Includes both GPA and Non-GPA modules regardless of exclusion state.
 */
export function calculateCourseSummary(
  sheets: MockSheet[],
  manualCredits: Record<string, number> = {},
): { totalCourseCredits: number; totalModules: number } {
  const distinct = new Map<string, number>();
  for (const sheet of sheets) {
    const norm = normalizeModuleCode(sheet.courseCode);
    if (!distinct.has(norm)) {
      const manualCr = manualCredits[norm] ?? manualCredits[sheet.courseCode.toUpperCase()];
      const inferredCr = creditFromCode(sheet.courseCode);
      const credits = manualCr !== undefined ? manualCr : (inferredCr ?? 0);
      distinct.set(norm, credits);
    }
  }
  return {
    totalCourseCredits: Array.from(distinct.values()).reduce((sum, cr) => sum + cr, 0),
    totalModules: distinct.size,
  };
}

/**
 * Resolves the effective working grade and status for a row,
 * taking user edits into account while keeping original extracted values untouched.
 */
export function resolveRowGradeStatus(
  sheetId: string,
  indexNumber: string,
  moduleCode: string,
  originalGrade: string | null,
  originalStatus: string | null,
  userEdits: Record<string, string> = {},
): {
  workingGrade: string | null;
  workingStatus: string | null;
  editedValue: string | null;
  isEdited: boolean;
} {
  const normMod = normalizeModuleCode(moduleCode);
  const normIdx = normalizeIndex(indexNumber);
  const editKeySheet = `${sheetId}:${normIdx}:${normMod}`;
  const editKeyGen = `${normIdx}:${normMod}`;
  const editedVal = userEdits[editKeySheet] ?? userEdits[editKeyGen];
  const isEdited = editedVal !== undefined && editedVal !== null && editedVal !== '';

  if (!isEdited) {
    return {
      workingGrade: originalGrade,
      workingStatus: originalStatus,
      editedValue: null,
      isEdited: false,
    };
  }

  const parsed = parseCellValue(editedVal);
  return {
    workingGrade: parsed.grade,
    workingStatus: parsed.statuses.length > 0 ? parsed.statuses[0] : null,
    editedValue: editedVal,
    isEdited: true,
  };
}

/**
 * Pure calculation function: searches for a student across all sheets,
 * applies repeat/resit rules, credit overrides, exclusions, and user edits,
 * then returns SGPA, CGPA, and degree classification.
 */
export function calculateStudentSearch(
  sheets: MockSheet[],
  rawQuery: string,
  config: UniversityConfig,
  manualCredits: Record<string, number> = {},
  userExclusions: Record<string, boolean> = {},
  moduleExclusions: Record<string, boolean> = {},
  userEdits: Record<string, string> = {},
): StudentSearchResult | null {
  const q = normalizeIndex(rawQuery);
  if (!q) return null;

  // Normalize exclusion keys for robust matching across whitespace and formatting
  const normModuleExclusions: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(moduleExclusions)) {
    normModuleExclusions[normalizeModuleCode(k)] = v;
  }

  const normUserExclusions: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(userExclusions)) {
    if (k.includes(':')) {
      const [idx, m] = k.split(':');
      normUserExclusions[`${normalizeIndex(idx)}:${normalizeModuleCode(m)}`] = v;
    } else {
      normUserExclusions[normalizeModuleCode(k)] = v;
    }
  }

  const originalSheets = sheets.filter((s) => s.type !== 'repeat-resit');
  const repeatSheets = sheets.filter((s) => s.type === 'repeat-resit');

  // Map to find repeat rows for this student: key = normalized courseCode
  // Multi-resit handling (spec Assumption A3):
  // Collect all repeat entries for each course code, then select the latest gradable one.
  // Ungradable results (AB, N, W) must never overwrite a previously valid gradable resit.
  const repeatCandidates = new Map<string, Array<{ sheet: MockSheet; row: MockResultRow; order: number }>>();
  repeatSheets.forEach((rSheet, order) => {
    for (const row of rSheet.rows) {
      if (normalizeIndex(row.indexNumber).includes(q)) {
        const normCode = normalizeModuleCode(rSheet.courseCode);
        if (!repeatCandidates.has(normCode)) {
          repeatCandidates.set(normCode, []);
        }
        repeatCandidates.get(normCode)!.push({ sheet: rSheet, row, order });
      }
    }
  });

  const studentRepeatRows = new Map<
    string,
    {
      row: MockResultRow;
      workingGrade: string | null;
      workingStatus: string | null;
      isEdited: boolean;
      editedValue: string | null;
    }
  >();
  for (const [normCode, candidates] of repeatCandidates.entries()) {
    const resolvedCandidates = candidates.map((c) => {
      const resolved = resolveRowGradeStatus(
        c.sheet.id,
        c.row.indexNumber,
        c.row.moduleCode,
        c.row.grade,
        c.row.status,
        userEdits,
      );
      return {
        ...c,
        resolved,
      };
    });

    const gradable = resolvedCandidates.filter((c) =>
      isGradableResit(c.resolved.workingGrade, c.resolved.workingStatus),
    );
    const pool = gradable.length > 0 ? gradable : resolvedCandidates;
    pool.sort((a, b) => b.order - a.order);
    const best = pool[0];
    studentRepeatRows.set(normCode, {
      row: best.row,
      workingGrade: best.resolved.workingGrade,
      workingStatus: best.resolved.workingStatus,
      isEdited: best.resolved.isEdited,
      editedValue: best.resolved.editedValue,
    });
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
        const normCode = normalizeModuleCode(row.moduleCode);
        const manualCr = manualCredits[normCode] ?? manualCredits[modCode];
        const inferredCr = creditFromCode(row.moduleCode);
        const credits = manualCr !== undefined ? manualCr : (inferredCr ?? 0);
        const manualCreditApplied = manualCr !== undefined;

        const resolved = resolveRowGradeStatus(
          sheet.id,
          row.indexNumber,
          row.moduleCode,
          row.grade,
          row.status,
          userEdits,
        );

        // Check for repeat result (lookup by normalized module code)
        const repeatInfo = studentRepeatRows.get(normCode) ?? studentRepeatRows.get(modCode);
        let resitInfo: ResitDetail | undefined;
        let effective;

        if (repeatInfo) {
          effective = effectiveResult({
            originalGrade: resolved.workingGrade as Grade | null,
            originalStatus: resolved.workingStatus,
            repeatGrade: repeatInfo.workingGrade as Grade | null,
            repeatStatus: repeatInfo.workingStatus,
            config,
          });
          resitInfo = {
            originalGrade: resolved.workingGrade,
            originalStatus: resolved.workingStatus,
            repeatGrade: repeatInfo.workingGrade,
            repeatStatus: repeatInfo.workingStatus,
            capped: effective.capped,
            note: effective.note,
          };
        } else {
          effective = effectiveResult({
            originalGrade: resolved.workingGrade as Grade | null,
            originalStatus: resolved.workingStatus,
            repeatGrade: null,
            repeatStatus: null,
            config,
          });
        }

        // Check user & module exclusion (green/red dot toggle or student-level exclusion)
        const exclusionKey = `${normalizeIndex(row.indexNumber)}:${normCode}`;
        const isModuleExcluded =
          !!normModuleExclusions[normCode] ||
          !!normUserExclusions[normCode] ||
          !!normUserExclusions[exclusionKey];
        const excluded = effective.excluded || isModuleExcluded;

        const gpaGrade = effective.gpaGrade;
        const gpaPointsVal =
          excluded || gpaGrade === null
            ? null
            : gradePoints(gpaGrade, config.gradeScale);

        const rowFlags = resolved.isEdited && !row.flags.includes('edited')
          ? [...row.flags, 'edited' as const]
          : row.flags;

        const effectiveRowGrade = resolved.isEdited ? resolved.workingGrade : row.grade;
        const effectiveRowStatus = resolved.isEdited ? resolved.workingStatus : row.status;
        const effectiveWorkingValue = resolved.isEdited
          ? (resolved.editedValue ?? row.workingValue)
          : row.workingValue;

        semesterRowItems.push({
          row: {
            ...row,
            grade: effectiveRowGrade,
            status: effectiveRowStatus,
            workingValue: effectiveWorkingValue,
            flags: rowFlags,
          },
          courseName: sheet.courseName,
          sheetId: sheet.id,
          sheetDisplayName: sheet.displayName,
          academicYear: sheet.academicYear ?? extractAcademicYear(sheet.courseCode),
          credits,
          manualCreditApplied,
          gpaPoints: gpaPointsVal,
          effectiveGrade: gpaGrade,
          excluded,
          isUserExcluded: isModuleExcluded,
          resitInfo,
          originalGrade: row.grade,
          originalStatus: row.status,
          editedValue: resolved.editedValue,
          isEdited: resolved.isEdited,
        });
      }
    }

    if (semesterRowItems.length === 0) continue;

    // Deduplicate semester rows by normalized module code so duplicate rows are never counted twice (spec §4 & M7)
    const distinctSemesterRows: SemesterRowItem[] = [];
    const seenSemesterMods = new Set<string>();
    for (const item of semesterRowItems) {
      const norm = normalizeModuleCode(item.row.moduleCode);
      if (!seenSemesterMods.has(norm)) {
        seenSemesterMods.add(norm);
        distinctSemesterRows.push(item);
      }
    }

    const gpaInputs = distinctSemesterRows.map((d) => ({
      gpaGrade: d.excluded ? null : (d.effectiveGrade as Grade | null),
      credits: d.credits,
    }));

    const { gpa: sgpa, moduleCount, totalCredits } = calculateSgpa(
      gpaInputs,
      config.gradeScale,
    );

    // Total Course Credits and Total Modules include ALL modules in this semester (both GPA & Non-GPA, green or red)
    const semTotalModules = distinctSemesterRows.length;
    const semTotalCourseCredits = distinctSemesterRows.reduce((sum, item) => sum + item.credits, 0);
    const hasGpa = moduleCount > 0;

    semesters.push({
      sheet: group.sheets[0],
      sheets: group.sheets,
      semesterName: group.semesterName,
      isUnassigned: group.isUnassigned,
      rows: distinctSemesterRows,
      sgpa,
      moduleCount,
      totalCredits,
      totalCourseCredits: semTotalCourseCredits,
      totalModules: semTotalModules,
      hasGpa,
    });
  }

  // Handle students appearing only on repeat sheets (spec Assumption A2)
  for (const rSheet of repeatSheets) {
    const modCode = rSheet.courseCode.toUpperCase();
    const normModCode = normalizeModuleCode(rSheet.courseCode);
    const alreadyCovered = originalSheets.some(
      (s) => normalizeModuleCode(s.courseCode) === normModCode,
    );
    if (!alreadyCovered) {
      const matchingRepeatRows = rSheet.rows.filter((r) =>
        normalizeIndex(r.indexNumber).includes(q),
      );
      if (matchingRepeatRows.length > 0) {
        if (!foundIndexNumber && matchingRepeatRows[0]) {
          foundIndexNumber = matchingRepeatRows[0].indexNumber;
        }
        const rowItems: SemesterRowItem[] = matchingRepeatRows.map((r) => {
          const normCode = normalizeModuleCode(rSheet.courseCode);
          const manualCr = manualCredits[normCode] ?? manualCredits[modCode];
          const inferredCr = creditFromCode(r.moduleCode);
          const credits = manualCr !== undefined ? manualCr : (inferredCr ?? 0);
          const exclusionKey = `${normalizeIndex(r.indexNumber)}:${normCode}`;
          const isModuleExcluded =
            !!normModuleExclusions[normCode] ||
            !!normUserExclusions[normCode] ||
            !!normUserExclusions[exclusionKey];

          const resolved = resolveRowGradeStatus(
            rSheet.id,
            r.indexNumber,
            r.moduleCode,
            r.grade,
            r.status,
            userEdits,
          );

          const effective = effectiveResult({
            originalGrade: null,
            originalStatus: null,
            repeatGrade: resolved.workingGrade as Grade | null,
            repeatStatus: resolved.workingStatus,
            config,
          });

          const excluded = effective.excluded || isModuleExcluded;
          const gpaGrade = effective.gpaGrade;
          const gpaPointsVal =
            excluded || gpaGrade === null
              ? null
              : gradePoints(gpaGrade, config.gradeScale);

          const rowFlags = resolved.isEdited && !r.flags.includes('edited')
            ? [...r.flags, 'edited' as const]
            : r.flags;

          return {
            row: {
              ...r,
              flags: rowFlags,
            },
            courseName: rSheet.courseName,
            sheetId: rSheet.id,
            sheetDisplayName: rSheet.displayName,
            credits,
            manualCreditApplied: manualCr !== undefined,
            gpaPoints: gpaPointsVal,
            effectiveGrade: gpaGrade,
            excluded,
            isUserExcluded: isModuleExcluded,
            resitInfo: {
              originalGrade: null,
              originalStatus: null,
              repeatGrade: resolved.workingGrade,
              repeatStatus: resolved.workingStatus,
              capped: false,
              note: 'No original sheet found — counts in resit session (spec A2)',
              noOriginalFound: true,
            },
            originalGrade: r.grade,
            originalStatus: r.status,
            editedValue: resolved.editedValue,
            isEdited: resolved.isEdited,
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

        const semDistinct = new Map<string, number>();
        for (const item of rowItems) {
          const norm = normalizeModuleCode(item.row.moduleCode);
          if (!semDistinct.has(norm)) {
            semDistinct.set(norm, item.credits);
          }
        }
        const semTotalModules = semDistinct.size;
        const semTotalCourseCredits = Array.from(semDistinct.values()).reduce((sum, cr) => sum + cr, 0);

        semesters.push({
          sheet: rSheet,
          sheets: [rSheet],
          semesterName: rSheet.examSession ?? 'Resit session',
          isUnassigned: !rSheet.examSession,
          rows: rowItems,
          sgpa,
          moduleCount,
          totalCredits,
          totalCourseCredits: semTotalCourseCredits,
          totalModules: semTotalModules,
          hasGpa: moduleCount > 0,
        });
      }
    }
  }

  if (semesters.length === 0) return null;

  // Compute overall CGPA across all active semesters (spec §4 & M7)
  // Deduplicate modules across semesters so no module is counted twice in CGPA
  const cgpaModulesMap = new Map<string, GpaInput>();
  for (const s of semesters) {
    for (const d of s.rows) {
      const norm = normalizeModuleCode(d.row.moduleCode);
      const input: GpaInput = {
        gpaGrade: d.excluded ? null : (d.effectiveGrade as Grade | null),
        credits: d.credits,
      };
      if (!cgpaModulesMap.has(norm)) {
        cgpaModulesMap.set(norm, input);
      } else {
        const existing = cgpaModulesMap.get(norm)!;
        if (input.gpaGrade !== null || existing.gpaGrade === null) {
          cgpaModulesMap.set(norm, input);
        }
      }
    }
  }
  const allGpaInputs = Array.from(cgpaModulesMap.values());

  const {
    gpa: cgpa,
    moduleCount: cgpaModuleCount,
    totalCredits: cgpaTotalCredits,
  } = calculateCgpa(allGpaInputs, config.gradeScale);

  // Total Course Credits and Total Modules across all loaded semesters (GPA + Non-GPA, green or red)
  const allDistinct = new Map<string, number>();
  for (const s of semesters) {
    for (const item of s.rows) {
      const norm = normalizeModuleCode(item.row.moduleCode);
      if (!allDistinct.has(norm)) {
        allDistinct.set(norm, item.credits);
      }
    }
  }
  const totalModules = allDistinct.size;
  const totalCourseCredits = Array.from(allDistinct.values()).reduce((sum, cr) => sum + cr, 0);

  const hasCgpa = cgpaModuleCount > 0;
  const classification = hasCgpa ? classify(cgpa, config.classificationBands) : null;

  return {
    indexNumber: foundIndexNumber ?? rawQuery,
    semesters,
    cgpa,
    cgpaModuleCount,
    cgpaTotalCredits,
    totalCourseCredits,
    totalModules,
    classification,
    hasCgpa,
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

  const [moduleExclusions, setModuleExclusions] = useState<Record<string, boolean>>(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const saved = sessionStorage.getItem(MODULE_EXCLUSIONS_KEY);
        return saved ? JSON.parse(saved) : {};
      }
      return {};
    } catch {
      return {};
    }
  });

  const [userEdits, setUserEdits] = useState<Record<string, string>>(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        const saved = sessionStorage.getItem(EDITS_KEY);
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

  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(MODULE_EXCLUSIONS_KEY, JSON.stringify(moduleExclusions));
      }
    } catch {
      // Ignore quota errors
    }
  }, [moduleExclusions]);

  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(EDITS_KEY, JSON.stringify(userEdits));
      }
    } catch {
      // Ignore quota errors
    }
  }, [userEdits]);

  /** Check if a course code is already loaded in the session (M4/M8 duplicate check) */
  const checkDuplicate = useCallback(
    (courseCode: string, type?: 'original' | 'repeat-resit'): MockSheet | undefined => {
      const cleanCode = normalizeModuleCode(courseCode);
      return sheets.find(
        (s) =>
          normalizeModuleCode(s.courseCode) === cleanCode &&
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
    setSheets((prev) =>
      prev.map((s) => (s.id === existingId ? { ...newSheet, id: existingId } : s)),
    );
  }, []);

  /** Remove a sheet by id and clean up orphaned edits/exclusions/credits */
  const removeSheet = useCallback((id: string) => {
    setSheets((prev) => {
      const remainingSheets = prev.filter((s) => s.id !== id);
      const remainingNormMods = new Set(
        remainingSheets.map((s) => normalizeModuleCode(s.courseCode)),
      );

      // Clean up orphaned edits: sheet-specific edits for removed sheet and
      // general edits whose module code no longer exists in any remaining sheet
      setUserEdits((prevEdits) => {
        const nextEdits: Record<string, string> = {};
        for (const [key, val] of Object.entries(prevEdits)) {
          if (key.startsWith(`${id}:`)) {
            // Sheet-specific edit for removed sheet - prune
            continue;
          }
          if (key.includes(':')) {
            const parts = key.split(':');
            const mod = parts[parts.length - 1]; // last part is normMod
            if (!remainingNormMods.has(mod)) {
              // Module no longer exists in any remaining sheet - prune
              continue;
            }
          }
          nextEdits[key] = val;
        }
        return nextEdits;
      });

      // Clean up module exclusions for modules no longer in remaining sheets
      setModuleExclusions((prevEx) => {
        const nextEx: Record<string, boolean> = {};
        for (const [mod, val] of Object.entries(prevEx)) {
          if (remainingNormMods.has(normalizeModuleCode(mod))) {
            nextEx[mod] = val;
          }
        }
        return nextEx;
      });

      // Clean up manual credits for modules no longer in remaining sheets
      setManualCredits((prevCredits) => {
        const nextCredits: Record<string, number> = {};
        for (const [mod, val] of Object.entries(prevCredits)) {
          if (remainingNormMods.has(normalizeModuleCode(mod))) {
            nextCredits[mod] = val;
          }
        }
        return nextCredits;
      });

      return remainingSheets;
    });
  }, []);

  /** Clear entire session */
  const clearSession = useCallback(() => {
    setSheets([]);
    setManualCredits({});
    setUserExclusions({});
    setModuleExclusions({});
    setUserEdits({});
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(MANUAL_CREDITS_KEY);
        sessionStorage.removeItem(EXCLUSIONS_KEY);
        sessionStorage.removeItem(MODULE_EXCLUSIONS_KEY);
        sessionStorage.removeItem(EDITS_KEY);
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

  /** Set or update a manually corrected grade/status for a student's module (M6) */
  const setGradeEdit = useCallback(
    (indexNumber: string, moduleCode: string, newValue: string, sheetId?: string) => {
      const normMod = normalizeModuleCode(moduleCode);
      const normIdx = normalizeIndex(indexNumber);
      const trimmed = newValue.trim();
      if (!isValidGradeOrStatus(trimmed)) {
        throw new Error(`Invalid grade or status: "${newValue}"`);
      }
      setUserEdits((prev) => {
        const next = { ...prev };
        if (sheetId) {
          next[`${sheetId}:${normIdx}:${normMod}`] = trimmed;
        }
        next[`${normIdx}:${normMod}`] = trimmed;
        return next;
      });
    },
    [],
  );

  /** Clear an edited grade/status, restoring the original extracted value (M6) */
  const clearGradeEdit = useCallback(
    (indexNumber: string, moduleCode: string, sheetId?: string) => {
      const normMod = normalizeModuleCode(moduleCode);
      const normIdx = normalizeIndex(indexNumber);
      setUserEdits((prev) => {
        const next = { ...prev };
        if (sheetId) {
          delete next[`${sheetId}:${normIdx}:${normMod}`];
        }
        delete next[`${normIdx}:${normMod}`];
        return next;
      });
    },
    [],
  );

  /** Toggle module-level inclusion/exclusion in GPA (green dot = include, red dot = exclude) */
  const toggleModule = useCallback((moduleCode: string) => {
    const norm = normalizeModuleCode(moduleCode);
    setModuleExclusions((prev) => ({
      ...prev,
      [norm]: !prev[norm],
    }));
  }, []);

  /** Toggle user exclusion for a student's module (supports module-level and student-level) */
  const toggleModuleExclusion = useCallback((indexNumber: string, moduleCode: string) => {
    const norm = normalizeModuleCode(moduleCode);
    const key = `${normalizeIndex(indexNumber)}:${moduleCode.toUpperCase()}`;
    setUserExclusions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
    setModuleExclusions((prev) => ({
      ...prev,
      [norm]: !prev[norm],
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
      return calculateStudentSearch(
        sheets,
        rawQuery,
        config,
        manualCredits,
        userExclusions,
        moduleExclusions,
        userEdits,
      );
    },
    [sheets, manualCredits, userExclusions, moduleExclusions, userEdits, config],
  );

  return {
    sheets,
    moduleExclusions,
    userEdits,
    setGradeEdit,
    clearGradeEdit,
    toggleModule,
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
