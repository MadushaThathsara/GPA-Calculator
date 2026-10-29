/**
 * store/useSessionStore.test.ts
 *
 * Tests for the M4 & M5 session calculation engine:
 *  - Sheet addition and duplicate detection (M4)
 *  - Replace sheet flow (M4)
 *  - Repeat / resit linking with effectiveResult capping (M4)
 *  - Index-number search with normalization (M5)
 *  - Manual credit override and GPA recalculation (M5)
 *  - Module include/exclude toggle and GPA recalculation (M5)
 */

import { describe, it, expect } from 'vitest';
import {
  calculateStudentSearch,
  normalizeIndex,
  normalizeModuleCode,
  calculateCourseSummary,
} from './useSessionStore';
import { formatSgpa } from '../engine/gpa';
import uocConfig from '../rules/universities/uoc';
import { SAMPLE_SHEET_1, SAMPLE_SHEET_2, SAMPLE_SHEET_3_RESIT } from './sampleSheets';

describe('normalizeIndex', () => {
  it('normalizes various index number string formats', () => {
    expect(normalizeIndex('ICT/23/811')).toBe('ICT23811');
    expect(normalizeIndex('ict/23/811')).toBe('ICT23811');
    expect(normalizeIndex('ict 23 811')).toBe('ICT23811');
    expect(normalizeIndex('811')).toBe('811');
  });
});

describe('normalizeModuleCode', () => {
  it('normalizes whitespace and casing in module codes', () => {
    expect(normalizeModuleCode('ITC 1052')).toBe('ITC1052');
    expect(normalizeModuleCode('iic 2172')).toBe('IIC2172');
    expect(normalizeModuleCode('  IC3433 ')).toBe('IC3433');
  });
});

describe('calculateStudentSearch (Milestones M4 & M5)', () => {
  it('normalizes search queries for case, spaces and slashes (M5)', () => {
    const sheets = [SAMPLE_SHEET_1];

    const res1 = calculateStudentSearch(sheets, 'ICT/23/811', uocConfig);
    expect(res1).not.toBeNull();
    expect(res1?.indexNumber).toBe('ICT/23/811');

    const res2 = calculateStudentSearch(sheets, 'ict/23/811', uocConfig);
    expect(res2).not.toBeNull();
    expect(res2?.indexNumber).toBe('ICT/23/811');

    const res3 = calculateStudentSearch(sheets, '811', uocConfig);
    expect(res3).not.toBeNull();

    const res4 = calculateStudentSearch(sheets, 'ict 23 811', uocConfig);
    expect(res4).not.toBeNull();

    const res5 = calculateStudentSearch(sheets, 'UNKNOWN', uocConfig);
    expect(res5).toBeNull();
  });

  it('calculates SGPA, CGPA, credits, and classification correctly (M5)', () => {
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];

    // Student 811:
    // Sheet 1: IC3433 (3 cr) Grade A- (3.7) -> 3 * 3.7 = 11.1
    // Sheet 2: IC3442 (2 cr) Grade A (4.0) -> 2 * 4.0 = 8.0
    // Total credits = 5, Total points = 19.1
    // CGPA = 19.1 / 5 = 3.82 -> First Class (>= 3.70)
    const student = calculateStudentSearch(sheets, '811', uocConfig);
    expect(student).not.toBeNull();
    expect(student?.semesters).toHaveLength(2);
    expect(student?.cgpaTotalCredits).toBe(5);
    expect(student?.cgpaModuleCount).toBe(2);
    expect(student?.cgpa).toBeCloseTo(3.82, 2);
    expect(student?.classification).toBe('First Class');

    // SGPA formats to 4 decimal places with trailing zeros
    expect(formatSgpa(student?.semesters[0].sgpa!)).toBe('3.7000');
    expect(formatSgpa(student?.semesters[1].sgpa!)).toBe('4.0000');
  });

  it('links repeat/resit sheets and applies cap rules to original semester (M4)', () => {
    // SAMPLE_SHEET_1 has 906 with original C- (1.3)
    // SAMPLE_SHEET_3_RESIT has 906 with repeat B+ (3.3) -> cap at B (3.0)
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_3_RESIT];

    const student906 = calculateStudentSearch(sheets, '906', uocConfig);
    expect(student906).not.toBeNull();

    const semRow = student906?.semesters[0]?.rows[0];
    expect(semRow).toBeDefined();
    expect(semRow?.resitInfo).toBeDefined();
    expect(semRow?.resitInfo?.capped).toBe(true);
    expect(semRow?.resitInfo?.originalGrade).toBe('C-');
    expect(semRow?.resitInfo?.repeatGrade).toBe('B+');
    expect(semRow?.effectiveGrade).toBe('B'); // capped at B
    expect(semRow?.gpaPoints).toBe(3.0);
  });

  it('uncapped full repeat grade for AB original (M4)', () => {
    // SAMPLE_SHEET_1 has 909 with original AB(ESA)
    // SAMPLE_SHEET_3_RESIT has 909 with repeat A (4.0)
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_3_RESIT];

    const student909 = calculateStudentSearch(sheets, '909', uocConfig);
    expect(student909).not.toBeNull();

    const semRow = student909?.semesters[0]?.rows[0];
    expect(semRow).toBeDefined();
    expect(semRow?.resitInfo?.capped).toBe(false);
    expect(semRow?.effectiveGrade).toBe('A');
    expect(semRow?.gpaPoints).toBe(4.0);
  });

  it('allows manual credit overrides and updates GPA (M5)', () => {
    const sheets = [SAMPLE_SHEET_1];

    const before = calculateStudentSearch(sheets, '811', uocConfig);
    expect(before?.cgpaTotalCredits).toBe(3);

    const manualCredits = { IC3433: 4 };
    const after = calculateStudentSearch(sheets, '811', uocConfig, manualCredits);
    expect(after?.cgpaTotalCredits).toBe(4);
  });

  it('toggles per-module include/exclude and updates GPA (M5)', () => {
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];

    const before = calculateStudentSearch(sheets, '811', uocConfig);
    expect(before?.cgpaModuleCount).toBe(2);

    const userExclusions = { 'ICT23811:IC3433': true };
    const after = calculateStudentSearch(sheets, '811', uocConfig, {}, userExclusions);
    expect(after?.cgpaModuleCount).toBe(1);
    expect(after?.cgpaTotalCredits).toBe(2); // Only IC3442 remaining
  });

  it('groups multiple sheets from the same semester into one semester result with combined SGPA (M4)', () => {
    // Two distinct courses taken in the SAME semester
    const sheetA: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'sheet-a',
      courseCode: 'IC3433',
      courseName: 'Internet Technology',
      examSession: 'First Semester 2024/2025',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'IC3433',
          grade: 'A', // 4.0, 3 credits -> 12.0
          status: null,
          flags: [],
          textReading: 'A',
          ocrReading: 'A',
          workingValue: 'A',
        },
      ],
    };

    const sheetB: typeof SAMPLE_SHEET_2 = {
      ...SAMPLE_SHEET_2,
      id: 'sheet-b',
      courseCode: 'IC3442',
      courseName: 'Database Systems',
      examSession: 'First Semester 2024/2025', // SAME semester!
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'IC3442',
          grade: 'C', // 2.0, 2 credits -> 4.0
          status: null,
          flags: [],
          textReading: 'C',
          ocrReading: 'C',
          workingValue: 'C',
        },
      ],
    };

    const student = calculateStudentSearch([sheetA, sheetB], '811', uocConfig);
    expect(student).not.toBeNull();
    // Must be grouped into exactly 1 semester
    expect(student?.semesters).toHaveLength(1);
    const sem = student?.semesters[0];
    expect(sem?.semesterName).toBe('First Semester 2024/2025');
    expect(sem?.rows).toHaveLength(2);
    expect(sem?.moduleCount).toBe(2);
    expect(sem?.totalCredits).toBe(5);
    // Combined SGPA = (12.0 + 4.0) / 5 = 16.0 / 5 = 3.2000
    expect(sem?.sgpa).toBeCloseTo(3.2, 4);
    expect(formatSgpa(sem?.sgpa!)).toBe('3.2000');
    expect(student?.cgpa).toBeCloseTo(3.2, 2);
  });

  it('selects latest gradable resit and does not let ungradable AB overwrite it (Assumption A3)', () => {
    // Original sheet: student got D
    const origSheet: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'orig',
      courseCode: 'IC3433',
      examSession: 'First Semester 2024/2025',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'IC3433',
          grade: 'D', // 1.0
          status: null,
          flags: [],
          textReading: 'D',
          ocrReading: 'D',
          workingValue: 'D',
        },
      ],
    };

    // Resit 1 (earlier): student got B (3.0)
    const resit1: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'resit-1',
      courseCode: 'IC3433',
      examSession: 'Resit Exam 2024',
      type: 'repeat-resit',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'IC3433',
          grade: 'B',
          status: null,
          flags: [],
          textReading: 'B',
          ocrReading: 'B',
          workingValue: 'B',
        },
      ],
    };

    // Resit 2 (later): student was absent (AB)
    const resit2: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'resit-2',
      courseCode: 'IC3433',
      examSession: 'Resit Exam 2025',
      type: 'repeat-resit',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'IC3433',
          grade: null,
          status: 'AB',
          flags: [],
          textReading: 'AB',
          ocrReading: 'AB',
          workingValue: 'AB',
        },
      ],
    };

    // resit2 was uploaded after resit1, but resit2 is ungradable AB
    const student = calculateStudentSearch([origSheet, resit1, resit2], '811', uocConfig);
    expect(student).not.toBeNull();
    const semRow = student?.semesters[0]?.rows[0];
    expect(semRow?.effectiveGrade).toBe('B');
    expect(semRow?.gpaPoints).toBe(3.0);
    expect(semRow?.resitInfo?.repeatGrade).toBe('B');
  });

  it('groups modules strictly by examination session across different academic years', () => {
    // Year 1 module: ITC 1052
    const sheetYear1: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'sheet-year-1',
      courseCode: 'ITC1052',
      displayName: 'ITC1052_Maths.pdf',
      academicYear: 1,
      semesterNumber: 1,
      examYear: '2025',
      examSession: 'First Semester Examination in 2025',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'ITC1052',
          grade: 'A',
          status: null,
          flags: [],
          textReading: 'A',
          ocrReading: 'A',
          workingValue: 'A',
        },
      ],
    };

    // Year 2 module: IIC 2172 taken in the same First Semester Examination in 2025
    const sheetYear2: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'sheet-year-2',
      courseCode: 'IIC2172',
      displayName: 'IIC2172_OOP.pdf',
      academicYear: 2,
      semesterNumber: 1,
      examYear: '2025',
      examSession: 'First Semester Examination in 2025',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'IIC2172',
          grade: 'A-',
          status: null,
          flags: [],
          textReading: 'A-',
          ocrReading: 'A-',
          workingValue: 'A-',
        },
      ],
    };

    const student = calculateStudentSearch([sheetYear1, sheetYear2], '811', uocConfig);
    expect(student).not.toBeNull();
    // CRITICAL REQUIREMENT: Must remain in a single semester group!
    expect(student?.semesters).toHaveLength(1);
    expect(student?.semesters[0].semesterName).toBe('First Semester Examination in 2025');
    expect(student?.semesters[0].rows).toHaveLength(2);

    // Each row retains its respective academic year
    const row1 = student?.semesters[0].rows.find((r) => r.row.moduleCode === 'ITC1052');
    const row2 = student?.semesters[0].rows.find((r) => r.row.moduleCode === 'IIC2172');
    expect(row1?.academicYear).toBe(1);
    expect(row2?.academicYear).toBe(2);
  });

  it('groups unassigned sheets into Unassigned Examination Session', () => {
    const unassignedSheet: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'sheet-unassigned',
      courseCode: 'ITC1052',
      academicYear: 1,
      semesterNumber: null,
      examYear: null,
      examSession: null,
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'ITC1052',
          grade: 'A',
          status: null,
          flags: [],
          textReading: 'A',
          ocrReading: 'A',
          workingValue: 'A',
        },
      ],
    };

    const student = calculateStudentSearch([unassignedSheet], '811', uocConfig);
    expect(student).not.toBeNull();
    expect(student?.semesters).toHaveLength(1);
    expect(student?.semesters[0].semesterName).toBe('Semester Unassigned');
    expect(student?.semesters[0].isUnassigned).toBe(true);
  });
});

describe('calculateCourseSummary (Course Summary Display Rules)', () => {
  it('computes total course credits and total modules across distinct uploaded sheets', () => {
    // SAMPLE_SHEET_1: IC3433 (3 credits)
    // SAMPLE_SHEET_2: IC3442 (2 credits)
    // SAMPLE_SHEET_3_RESIT: repeat of IC3433
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2, SAMPLE_SHEET_3_RESIT];
    const summary = calculateCourseSummary(sheets);

    // IC3433 and IC3442 -> 2 distinct modules
    expect(summary.totalModules).toBe(2);
    // 3 credits + 2 credits = 5 total course credits
    expect(summary.totalCourseCredits).toBe(5);
  });

  it('reflects manual credit overrides in total course credits', () => {
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];
    const summary = calculateCourseSummary(sheets, { IC3433: 4 });
    expect(summary.totalModules).toBe(2);
    expect(summary.totalCourseCredits).toBe(6); // 4 + 2
  });
});

describe('Green/Red Module Selection & Recalculation Rules', () => {
  it('toggles module green/red, recalculating SGPA and CGPA immediately', () => {
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];

    // Initial state: both modules green (included)
    // Student 811:
    // IC3433 (3 cr) Grade A- (3.7) -> 11.1
    // IC3442 (2 cr) Grade A (4.0) -> 8.0
    // Total Course Credits = 5, Total Modules = 2
    // CGPA = 19.1 / 5 = 3.82
    const greenState = calculateStudentSearch(sheets, '811', uocConfig);
    expect(greenState).not.toBeNull();
    expect(greenState?.totalModules).toBe(2);
    expect(greenState?.totalCourseCredits).toBe(5);
    expect(greenState?.cgpa).toBeCloseTo(3.82, 2);
    expect(greenState?.classification).toBe('First Class');

    // Toggle IC3433 to Red (excluded)
    const redState = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, { IC3433: true });
    expect(redState).not.toBeNull();

    // Critical Requirement: Total Course Credits & Total Modules stay UNCHANGED
    expect(redState?.totalModules).toBe(2);
    expect(redState?.totalCourseCredits).toBe(5);

    // Module IC3433 contributes 0 to GPA: only IC3442 (2 cr, Grade A 4.0) counts
    expect(redState?.cgpaModuleCount).toBe(1);
    expect(redState?.cgpaTotalCredits).toBe(2);
    expect(redState?.cgpa).toBeCloseTo(4.0, 2);

    // Toggling back to Green (included) restores previous GPA immediately
    const restoredState = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, { IC3433: false });
    expect(restoredState?.cgpa).toBeCloseTo(3.82, 2);
    expect(restoredState?.totalModules).toBe(2);
    expect(restoredState?.totalCourseCredits).toBe(5);
  });

  it('normalizes module code whitespace for green/red toggle (e.g. "IC 3433" vs "IC3433")', () => {
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];
    const redState = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, { 'IC 3433': true });
    expect(redState?.cgpaModuleCount).toBe(1);
    expect(redState?.cgpaTotalCredits).toBe(2);
    expect(redState?.totalCourseCredits).toBe(5);
  });

  it('does NOT treat AB, N, W as GPA-eligible just because a module is green', () => {
    // SAMPLE_SHEET_1 has student 909 with AB(ESA)
    const sheets = [SAMPLE_SHEET_1];

    // Module is green (not excluded)
    const res = calculateStudentSearch(sheets, '909', uocConfig, {}, {}, {});
    expect(res).not.toBeNull();

    // Student has 1 module record (IC3433, 3 credits)
    expect(res?.totalModules).toBe(1);
    expect(res?.totalCourseCredits).toBe(3);

    // Because status is AB(ESA), it must remain excluded from GPA
    expect(res?.cgpaModuleCount).toBe(0);
    expect(res?.cgpaTotalCredits).toBe(0);
    expect(res?.cgpa).toBe(0);
    expect(res?.semesters[0].rows[0].excluded).toBe(true);
    expect(res?.semesters[0].rows[0].gpaPoints).toBeNull();
  });

  it('preserves resit/repeat capping logic when module is green and allows exclusion when red', () => {
    // SAMPLE_SHEET_1 has 906 with original C- (1.3)
    // SAMPLE_SHEET_3_RESIT has 906 with repeat B+ (3.3) -> cap at B (3.0)
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_3_RESIT];

    // Green state: capped at B (3.0)
    const greenRes = calculateStudentSearch(sheets, '906', uocConfig, {}, {}, {});
    expect(greenRes).not.toBeNull();
    const greenRow = greenRes?.semesters[0].rows[0];
    expect(greenRow?.resitInfo?.capped).toBe(true);
    expect(greenRow?.effectiveGrade).toBe('B');
    expect(greenRow?.gpaPoints).toBe(3.0);
    expect(greenRes?.cgpa).toBe(3.0);
    expect(greenRes?.totalModules).toBe(1);
    expect(greenRes?.totalCourseCredits).toBe(3);

    // Red state: excluded from GPA
    const redRes = calculateStudentSearch(sheets, '906', uocConfig, {}, {}, { IC3433: true });
    expect(redRes).not.toBeNull();
    const redRow = redRes?.semesters[0].rows[0];
    expect(redRow?.excluded).toBe(true);
    expect(redRow?.gpaPoints).toBeNull();
    expect(redRes?.cgpa).toBe(0);
    // Totals remain unchanged
    expect(redRes?.totalModules).toBe(1);
    expect(redRes?.totalCourseCredits).toBe(3);
  });
});
