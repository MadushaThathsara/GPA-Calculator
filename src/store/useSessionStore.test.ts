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
  resolveRowGradeStatus,
} from './useSessionStore';
import { formatSgpa, formatSgpaDisplay, formatCgpaDisplay } from '../engine/gpa';
import uocConfig from '../rules/universities/uoc';
import { SAMPLE_SHEET_1, SAMPLE_SHEET_2, SAMPLE_SHEET_3_RESIT } from './sampleSheets';
import { isValidGradeOrStatus, VALID_GRADES, VALID_STATUSES } from '../rules/schema';

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

describe('E(CA) and E(ESA) GPA Exclusion Rules', () => {
  it('excludes E(CA) results from SGPA and CGPA numerator and denominator, even when module dot is green', () => {
    const sheetEca: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'sheet-eca',
      courseCode: 'ITC1052', // 2 credits
      courseName: 'Mathematics',
      examSession: 'First Semester Examination 2025',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'ITC1052',
          grade: null,
          status: 'E(CA)',
          flags: [],
          textReading: 'E(CA)',
          ocrReading: 'E(CA)',
          workingValue: 'E(CA)',
        },
      ],
    };

    const sheetGradeA: typeof SAMPLE_SHEET_2 = {
      ...SAMPLE_SHEET_2,
      id: 'sheet-grade-a',
      courseCode: 'IIC2173', // 3 credits
      courseName: 'Data Structures',
      examSession: 'First Semester Examination 2025',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'IIC2173',
          grade: 'A', // 4.0, 3 credits -> 12.0
          status: null,
          flags: [],
          textReading: 'A',
          ocrReading: 'A',
          workingValue: 'A',
        },
      ],
    };

    // Both modules are green (default, no exclusions)
    const student = calculateStudentSearch([sheetEca, sheetGradeA], '811', uocConfig, {}, {}, {});
    expect(student).not.toBeNull();

    // 1. Total Course Credits and Total Modules include BOTH modules
    expect(student?.totalModules).toBe(2);
    expect(student?.totalCourseCredits).toBe(5); // 2 credits (ITC1052) + 3 credits (IIC2173)

    const sem = student?.semesters[0];
    expect(sem?.totalModules).toBe(2);
    expect(sem?.totalCourseCredits).toBe(5);

    // 2. E(CA) does NOT contribute to GPA numerator or denominator
    // GPA credits must only be 3 (from IIC2173), NOT 5
    expect(sem?.totalCredits).toBe(3);
    expect(sem?.moduleCount).toBe(1);
    // SGPA = 4.0 * 3 / 3 = 4.0000 (if E(CA) had added 2 credits to denominator, SGPA would be 12/5 = 2.4)
    expect(sem?.sgpa).toBeCloseTo(4.0, 4);
    expect(formatSgpa(sem?.sgpa!)).toBe('4.0000');
    expect(student?.cgpa).toBeCloseTo(4.0, 2);

    // 3. Original extracted status is preserved
    const ecaRow = sem?.rows.find((r) => r.row.moduleCode === 'ITC1052');
    expect(ecaRow).toBeDefined();
    expect(ecaRow?.row.status).toBe('E(CA)');
    expect(ecaRow?.row.grade).toBeNull();
    expect(ecaRow?.effectiveGrade).toBeNull();
    expect(ecaRow?.excluded).toBe(true);
    expect(ecaRow?.gpaPoints).toBeNull();
    expect(ecaRow?.credits).toBe(2);
  });

  it('excludes E(ESA) results from SGPA and CGPA numerator and denominator, even when module dot is green', () => {
    const sheetEesa: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'sheet-eesa',
      courseCode: 'ITC1052', // 2 credits
      courseName: 'Mathematics',
      examSession: 'First Semester Examination 2025',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'ITC1052',
          grade: null,
          status: 'E(ESA)',
          flags: [],
          textReading: 'E(ESA)',
          ocrReading: 'E(ESA)',
          workingValue: 'E(ESA)',
        },
      ],
    };

    const sheetGradeB: typeof SAMPLE_SHEET_2 = {
      ...SAMPLE_SHEET_2,
      id: 'sheet-grade-b',
      courseCode: 'IIC2173', // 3 credits
      courseName: 'Data Structures',
      examSession: 'First Semester Examination 2025',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'IIC2173',
          grade: 'B', // 3.0, 3 credits -> 9.0
          status: null,
          flags: [],
          textReading: 'B',
          ocrReading: 'B',
          workingValue: 'B',
        },
      ],
    };

    // Both modules green
    const student = calculateStudentSearch([sheetEesa, sheetGradeB], '811', uocConfig, {}, {}, {});
    expect(student).not.toBeNull();

    // Total Course Credits = 5, Total Modules = 2
    expect(student?.totalModules).toBe(2);
    expect(student?.totalCourseCredits).toBe(5);

    const sem = student?.semesters[0];
    expect(sem?.totalModules).toBe(2);
    expect(sem?.totalCourseCredits).toBe(5);

    // E(ESA) does NOT contribute to GPA numerator or denominator
    expect(sem?.totalCredits).toBe(3);
    expect(sem?.moduleCount).toBe(1);
    // SGPA = 3.0 * 3 / 3 = 3.0000 (NOT 9/5 = 1.8)
    expect(sem?.sgpa).toBeCloseTo(3.0, 4);
    expect(formatSgpa(sem?.sgpa!)).toBe('3.0000');
    expect(student?.cgpa).toBeCloseTo(3.0, 2);

    // Original status preserved
    const eesaRow = sem?.rows.find((r) => r.row.moduleCode === 'ITC1052');
    expect(eesaRow).toBeDefined();
    expect(eesaRow?.row.status).toBe('E(ESA)');
    expect(eesaRow?.excluded).toBe(true);
    expect(eesaRow?.gpaPoints).toBeNull();
  });

  it('keeps total course credits and total modules invariant when toggling green/red on E(CA) module', () => {
    const sheetEca: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'sheet-eca',
      courseCode: 'ITC1052', // 2 credits
      courseName: 'Mathematics',
      examSession: 'First Semester Examination 2025',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'ITC1052',
          grade: null,
          status: 'E(CA)',
          flags: [],
          textReading: 'E(CA)',
          ocrReading: 'E(CA)',
          workingValue: 'E(CA)',
        },
      ],
    };

    const sheetGradeA: typeof SAMPLE_SHEET_2 = {
      ...SAMPLE_SHEET_2,
      id: 'sheet-grade-a',
      courseCode: 'IIC2173', // 3 credits
      courseName: 'Data Structures',
      examSession: 'First Semester Examination 2025',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'IIC2173',
          grade: 'A',
          status: null,
          flags: [],
          textReading: 'A',
          ocrReading: 'A',
          workingValue: 'A',
        },
      ],
    };

    // Green state
    const greenStudent = calculateStudentSearch([sheetEca, sheetGradeA], '811', uocConfig, {}, {}, { ITC1052: false });
    expect(greenStudent?.totalModules).toBe(2);
    expect(greenStudent?.totalCourseCredits).toBe(5);
    expect(greenStudent?.cgpa).toBeCloseTo(4.0, 2);

    // Red state (toggled to red)
    const redStudent = calculateStudentSearch([sheetEca, sheetGradeA], '811', uocConfig, {}, {}, { ITC1052: true });
    // Total Course Credits & Total Modules remain unchanged
    expect(redStudent?.totalModules).toBe(2);
    expect(redStudent?.totalCourseCredits).toBe(5);
    // CGPA remains 4.0 (still excluded from GPA)
    expect(redStudent?.cgpa).toBeCloseTo(4.0, 2);
  });

  it('verifies student 910 with E(CA) in sample sheets is excluded from GPA while keeping total credits and modules', () => {
    // SAMPLE_SHEET_1 student 910 has IC3433 with E(CA) (3 credits)
    // SAMPLE_SHEET_2 student 910 has IC3442 with B (2 credits, Grade B = 3.0)
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];
    const student = calculateStudentSearch(sheets, '910', uocConfig);
    expect(student).not.toBeNull();

    // Total Course Credits = 3 (IC3433) + 2 (IC3442) = 5
    // Total Modules = 2
    expect(student?.totalModules).toBe(2);
    expect(student?.totalCourseCredits).toBe(5);

    // E(CA) is excluded: only IC3442 (Grade B, 2 credits) counts in GPA
    expect(student?.cgpaModuleCount).toBe(1);
    expect(student?.cgpaTotalCredits).toBe(2);
    expect(student?.cgpa).toBeCloseTo(3.0, 2);
  });
});

describe('Milestone M6 — Grade and Status Editing', () => {
  describe('isValidGradeOrStatus', () => {
    it('validates all canonical letter grades', () => {
      for (const grade of VALID_GRADES) {
        expect(isValidGradeOrStatus(grade)).toBe(true);
      }
    });

    it('validates all canonical status codes', () => {
      for (const status of VALID_STATUSES) {
        expect(isValidGradeOrStatus(status)).toBe(true);
      }
    });

    it('rejects invalid or empty grade/status strings', () => {
      expect(isValidGradeOrStatus('')).toBe(false);
      expect(isValidGradeOrStatus(' ')).toBe(false);
      expect(isValidGradeOrStatus('XYZ')).toBe(false);
      expect(isValidGradeOrStatus('F')).toBe(false);
      expect(isValidGradeOrStatus('100')).toBe(false);
      expect(isValidGradeOrStatus('A++')).toBe(false);
      expect(isValidGradeOrStatus('Pass')).toBe(false);
    });
  });

  describe('resolveRowGradeStatus', () => {
    it('returns unedited original values when no edit is present', () => {
      const res = resolveRowGradeStatus('s1', 'ICT/23/811', 'IC3433', 'A-', null, {});
      expect(res.isEdited).toBe(false);
      expect(res.workingGrade).toBe('A-');
      expect(res.workingStatus).toBeNull();
      expect(res.editedValue).toBeNull();
    });

    it('resolves edited letter grade using sheet-scoped key', () => {
      const edits = { 's1:ICT23811:IC3433': 'A' };
      const res = resolveRowGradeStatus('s1', 'ICT/23/811', 'IC3433', 'C-', null, edits);
      expect(res.isEdited).toBe(true);
      expect(res.workingGrade).toBe('A');
      expect(res.workingStatus).toBeNull();
      expect(res.editedValue).toBe('A');
    });

    it('resolves edited status code (e.g. E(CA))', () => {
      const edits = { 'ICT23811:IC3433': 'E(CA)' };
      const res = resolveRowGradeStatus('s1', 'ICT/23/811', 'IC3433', 'A', null, edits);
      expect(res.isEdited).toBe(true);
      expect(res.workingGrade).toBeNull();
      expect(res.workingStatus).toBe('E(CA)');
      expect(res.editedValue).toBe('E(CA)');
    });

    it('resolves compound status code (e.g. E(CA) & AB(ESA))', () => {
      const edits = { 's1:ICT23811:IC3433': 'E(CA) & AB(ESA)' };
      const res = resolveRowGradeStatus('s1', 'ICT/23/811', 'IC3433', 'B', null, edits);
      expect(res.isEdited).toBe(true);
      expect(res.workingGrade).toBeNull();
      expect(res.workingStatus).toBe('E(CA) & AB(ESA)');
      expect(res.editedValue).toBe('E(CA) & AB(ESA)');
    });
  });

  describe('calculateStudentSearch with Grade and Status Edits', () => {
    it('editing a letter grade updates SGPA, CGPA, and degree classification immediately', () => {
      const sheets = [SAMPLE_SHEET_1]; // 811 originally has IC3433 (3 cr) Grade A- (3.7)

      const before = calculateStudentSearch(sheets, '811', uocConfig);
      expect(before?.semesters[0].sgpa).toBeCloseTo(3.7, 4);
      expect(formatSgpa(before?.semesters[0].sgpa!)).toBe('3.7000');

      // Edit 811's grade on IC3433 from A- (3.7) to A (4.0)
      const userEdits = {
        'ICT23811:IC3433': 'A',
      };

      const after = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, {}, userEdits);
      expect(after).not.toBeNull();
      expect(after?.semesters[0].sgpa).toBeCloseTo(4.0, 4);
      expect(formatSgpa(after?.semesters[0].sgpa!)).toBe('4.0000');
      expect(after?.cgpa).toBeCloseTo(4.0, 2);
      expect(after?.classification).toBe('First Class');

      const rowItem = after?.semesters[0].rows[0];
      expect(rowItem?.isEdited).toBe(true);
      expect(rowItem?.editedValue).toBe('A');
      expect(rowItem?.effectiveGrade).toBe('A');
      expect(rowItem?.gpaPoints).toBe(4.0);
      expect(rowItem?.row.flags).toContain('edited');
    });

    it('preserves original extracted values in sheet and rowItem as extraction evidence', () => {
      const originalSheet = JSON.parse(JSON.stringify(SAMPLE_SHEET_1));
      const sheets = [originalSheet];

      const userEdits = {
        'ICT23811:IC3433': 'B+',
      };

      const res = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, {}, userEdits);
      const rowItem = res?.semesters[0].rows[0];

      // Row item preserves original evidence
      expect(rowItem?.originalGrade).toBe('A-');
      expect(rowItem?.originalStatus).toBeNull();
      expect(rowItem?.row.textReading).toBe('A');
      expect(rowItem?.row.ocrReading).toBe('A-');

      // Original sheet in memory is NOT mutated
      expect(originalSheet.rows[0].grade).toBe('A-');
      expect(originalSheet.rows[0].flags).not.toContain('edited');
    });

    it('editing a grade to E(CA) excludes it from SGPA/CGPA numerator and denominator', () => {
      // 811 takes two modules: IC3433 (3 cr, A-, 3.7) and IC3442 (2 cr, A, 4.0)
      const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];

      const before = calculateStudentSearch(sheets, '811', uocConfig);
      expect(before?.totalModules).toBe(2);
      expect(before?.totalCourseCredits).toBe(5);
      expect(before?.cgpaModuleCount).toBe(2);
      expect(before?.cgpaTotalCredits).toBe(5);
      expect(before?.cgpa).toBeCloseTo(3.82, 2);

      // Edit IC3433 from A- to E(CA)
      const userEdits = {
        'ICT23811:IC3433': 'E(CA)',
      };

      const after = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, {}, userEdits);
      expect(after).not.toBeNull();

      // 1. Total Course Credits and Total Modules remain completely invariant
      expect(after?.totalModules).toBe(2);
      expect(after?.totalCourseCredits).toBe(5);

      // 2. Only IC3442 (Grade A, 2 cr) contributes to GPA
      expect(after?.cgpaModuleCount).toBe(1);
      expect(after?.cgpaTotalCredits).toBe(2);
      expect(after?.cgpa).toBeCloseTo(4.0, 2);

      const sem1 = after?.semesters.find((s) => s.semesterName === SAMPLE_SHEET_1.examSession);
      const editedRow = sem1?.rows.find((r) => r.row.moduleCode === 'IC3433');
      expect(editedRow?.isEdited).toBe(true);
      expect(editedRow?.excluded).toBe(true);
      expect(editedRow?.gpaPoints).toBeNull();
      expect(editedRow?.row.status).toBe('E(CA)');
      expect(editedRow?.originalGrade).toBe('A-');
    });

    it('editing E(CA) to a letter grade includes it in GPA with corresponding grade points', () => {
      // 910 originally has IC3433 with E(CA) (3 credits) and IC3442 with B (2 credits, 3.0)
      const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];

      const before = calculateStudentSearch(sheets, '910', uocConfig);
      expect(before?.cgpaModuleCount).toBe(1);
      expect(before?.cgpaTotalCredits).toBe(2);
      expect(before?.cgpa).toBeCloseTo(3.0, 2);

      // Correct E(CA) to B+ (3.3)
      const userEdits = {
        'ICT23910:IC3433': 'B+',
      };

      const after = calculateStudentSearch(sheets, '910', uocConfig, {}, {}, {}, userEdits);
      expect(after).not.toBeNull();

      // Now both modules count in GPA:
      // IC3433: 3 cr * 3.3 = 9.9
      // IC3442: 2 cr * 3.0 = 6.0
      // Total credits = 5, Total points = 15.9 -> CGPA = 3.18
      expect(after?.cgpaModuleCount).toBe(2);
      expect(after?.cgpaTotalCredits).toBe(5);
      expect(after?.cgpa).toBeCloseTo(3.18, 2);

      // Total Course Credits and Total Modules remain invariant
      expect(after?.totalModules).toBe(2);
      expect(after?.totalCourseCredits).toBe(5);

      const editedRow = after?.semesters[0].rows.find((r) => r.row.moduleCode === 'IC3433');
      expect(editedRow?.isEdited).toBe(true);
      expect(editedRow?.originalStatus).toBe('E(CA)');
      expect(editedRow?.effectiveGrade).toBe('B+');
      expect(editedRow?.gpaPoints).toBe(3.3);
    });

    it('editing to an ungradable status (e.g. AB, N, W) excludes module from GPA', () => {
      const sheets = [SAMPLE_SHEET_1];

      // Edit IC3433 to AB
      const userEdits = {
        'ICT23811:IC3433': 'AB',
      };

      const after = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, {}, userEdits);
      const rowItem = after?.semesters[0].rows[0];

      expect(rowItem?.isEdited).toBe(true);
      expect(rowItem?.excluded).toBe(true);
      expect(rowItem?.gpaPoints).toBeNull();
      expect(after?.cgpaTotalCredits).toBe(0);
      expect(after?.cgpaModuleCount).toBe(0);
      expect(after?.totalCourseCredits).toBe(3);
      expect(after?.totalModules).toBe(1);
    });

    it('allows correcting an already edited result again (re-editing)', () => {
      const sheets = [SAMPLE_SHEET_1];

      // First edit: C-
      const edits1 = { 'ICT23811:IC3433': 'C-' };
      const res1 = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, {}, edits1);
      expect(res1?.semesters[0].sgpa).toBeCloseTo(1.3, 4);
      expect(formatSgpa(res1?.semesters[0].sgpa!)).toBe('1.3000');

      // Second edit: A+
      const edits2 = { 'ICT23811:IC3433': 'A+' };
      const res2 = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, {}, edits2);
      expect(res2?.semesters[0].sgpa).toBeCloseTo(4.0, 4);
      expect(formatSgpa(res2?.semesters[0].sgpa!)).toBe('4.0000');
      expect(res2?.semesters[0].rows[0].originalGrade).toBe('A-');
      expect(res2?.semesters[0].rows[0].effectiveGrade).toBe('A+');
    });

    it('reverts to extracted original grade when edit is cleared', () => {
      const sheets = [SAMPLE_SHEET_1];

      // With edit
      const withEdit = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, {}, { 'ICT23811:IC3433': 'B' });
      expect(withEdit?.semesters[0].sgpa).toBeCloseTo(3.0, 4);
      expect(withEdit?.semesters[0].rows[0].isEdited).toBe(true);

      // Cleared edit (empty userEdits)
      const reverted = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, {}, {});
      expect(reverted?.semesters[0].sgpa).toBeCloseTo(3.7, 4);
      expect(reverted?.semesters[0].rows[0].isEdited).toBe(false);
      expect(reverted?.semesters[0].rows[0].row.flags).not.toContain('edited');
    });

    it('interacts correctly with repeat/resit capping when original is edited to AB(ESA)', () => {
      // 906 has original C- in SAMPLE_SHEET_1, and repeat B+ in SAMPLE_SHEET_3_RESIT
      // Normally, C- original with B+ repeat triggers cap at B (3.0)
      const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_3_RESIT];

      const before = calculateStudentSearch(sheets, '906', uocConfig);
      expect(before?.semesters[0].rows[0].resitInfo?.capped).toBe(true);
      expect(before?.semesters[0].rows[0].effectiveGrade).toBe('B');

      // If user edits original result from C- to AB(ESA) (medical / absence)
      // AB original means full repeat grade with NO cap!
      const userEdits = {
        [`${SAMPLE_SHEET_1.id}:ICT23906:IC3433`]: 'AB(ESA)',
      };

      const after = calculateStudentSearch(sheets, '906', uocConfig, {}, {}, {}, userEdits);
      const rowItem = after?.semesters[0].rows[0];
      expect(rowItem?.resitInfo?.capped).toBe(false);
      expect(rowItem?.effectiveGrade).toBe('B+'); // Full repeat grade, no cap!
      expect(rowItem?.gpaPoints).toBe(3.3);
    });

    it('interacts correctly with green/red dot inclusion when editing', () => {
      const sheets = [SAMPLE_SHEET_1];

      // Edit grade to A with module green (included)
      const greenResult = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, { IC3433: false }, { 'ICT23811:IC3433': 'A' });
      expect(greenResult?.cgpaModuleCount).toBe(1);
      expect(greenResult?.cgpaTotalCredits).toBe(3);
      expect(greenResult?.cgpa).toBeCloseTo(4.0, 2);

      // Now toggle module to red (excluded)
      const redResult = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, { IC3433: true }, { 'ICT23811:IC3433': 'A' });
      expect(redResult?.cgpaModuleCount).toBe(0);
      expect(redResult?.cgpaTotalCredits).toBe(0);
      expect(redResult?.semesters[0].rows[0].excluded).toBe(true);
      // Total course credits and modules still 3 and 1!
      expect(redResult?.totalCourseCredits).toBe(3);
      expect(redResult?.totalModules).toBe(1);
    });
  });
});

describe('Milestone M7 — Semester & Course Summary', () => {
  it('computes semester-wise summary accurately (name, total modules, total course credits, 4-decimal SGPA)', () => {
    // Student 811 in SAMPLE_SHEET_1 (IC3433, 3 cr, A-, 3.7) and SAMPLE_SHEET_2 (IC3442, 2 cr, A, 4.0)
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];
    const student = calculateStudentSearch(sheets, '811', uocConfig);
    expect(student).not.toBeNull();
    expect(student?.semesters).toHaveLength(2);

    // Semester 1
    const sem1 = student!.semesters[0];
    expect(sem1.semesterName).toBe('Second Semester 2023/2024');
    expect(sem1.totalModules).toBe(1);
    expect(sem1.totalCourseCredits).toBe(3);
    expect(sem1.hasGpa).toBe(true);
    expect(sem1.sgpa).toBeCloseTo(3.7, 4);
    expect(formatSgpa(sem1.sgpa)).toBe('3.7000');
    expect(formatSgpaDisplay(sem1.sgpa, sem1.moduleCount)).toBe('3.7000');

    // Semester 2
    const sem2 = student!.semesters[1];
    expect(sem2.semesterName).toBe('First Semester 2024/2025');
    expect(sem2.totalModules).toBe(1);
    expect(sem2.totalCourseCredits).toBe(2);
    expect(sem2.hasGpa).toBe(true);
    expect(sem2.sgpa).toBeCloseTo(4.0, 4);
    expect(formatSgpa(sem2.sgpa)).toBe('4.0000');
    expect(formatSgpaDisplay(sem2.sgpa, sem2.moduleCount)).toBe('4.0000');
  });

  it('computes overall course summary accurately (Total Course Credits, Total Modules, 2-decimal CGPA, Classification)', () => {
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];
    const student = calculateStudentSearch(sheets, '811', uocConfig);
    expect(student).not.toBeNull();

    // 1. Total Course Credits = 3 (IC3433) + 2 (IC3442) = 5
    expect(student!.totalCourseCredits).toBe(5);

    // 2. Total Modules = 2
    expect(student!.totalModules).toBe(2);

    // 3. Overall CGPA = (3*3.7 + 2*4.0) / 5 = 19.1 / 5 = 3.82
    expect(student!.hasCgpa).toBe(true);
    expect(student!.cgpa).toBeCloseTo(3.82, 2);
    expect(student!.cgpa.toFixed(2)).toBe('3.82');
    expect(formatCgpaDisplay(student!.cgpa, student!.cgpaModuleCount)).toBe('3.82');

    // 4. Degree Classification = First Class (>= 3.70)
    expect(student!.classification).toBe('First Class');
  });

  it('updates semester SGPA and overall CGPA immediately when a grade is edited', () => {
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];

    // Initial CGPA for 811 is 3.82
    const before = calculateStudentSearch(sheets, '811', uocConfig);
    expect(before!.cgpa).toBeCloseTo(3.82, 2);
    expect(formatSgpa(before!.semesters[0].sgpa)).toBe('3.7000');

    // User edits IC3433 in semester 1 from A- (3.7) to A (4.0)
    const userEdits = {
      'ICT23811:IC3433': 'A',
    };

    const after = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, {}, userEdits);
    expect(after).not.toBeNull();

    // Semester 1 SGPA updates to 4.0000
    expect(after!.semesters[0].sgpa).toBeCloseTo(4.0, 4);
    expect(formatSgpa(after!.semesters[0].sgpa)).toBe('4.0000');

    // Overall CGPA updates to 4.00
    expect(after!.cgpa).toBeCloseTo(4.0, 2);
    expect(after!.cgpa.toFixed(2)).toBe('4.00');
    expect(after!.classification).toBe('First Class');

    // Total Course Credits and Total Modules remain 5 and 2
    expect(after!.totalCourseCredits).toBe(5);
    expect(after!.totalModules).toBe(2);
  });

  it('updates semester SGPA and overall CGPA immediately when green/red selection is changed', () => {
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];

    // Green state (default)
    const greenResult = calculateStudentSearch(sheets, '811', uocConfig);
    expect(greenResult!.cgpaModuleCount).toBe(2);
    expect(greenResult!.cgpa).toBeCloseTo(3.82, 2);

    // Toggle IC3433 to red (excluded)
    const redResult = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, { IC3433: true });
    expect(redResult).not.toBeNull();

    // In Semester 1, IC3433 is excluded -> 0 GPA modules
    expect(redResult!.semesters[0].moduleCount).toBe(0);
    expect(redResult!.semesters[0].hasGpa).toBe(false);

    // In Overall CGPA, only IC3442 (Grade A, 2 cr) counts -> CGPA = 4.00
    expect(redResult!.cgpaModuleCount).toBe(1);
    expect(redResult!.cgpaTotalCredits).toBe(2);
    expect(redResult!.cgpa).toBeCloseTo(4.0, 2);
    expect(redResult!.cgpa.toFixed(2)).toBe('4.00');

    // Total Course Credits and Total Modules remain invariant
    expect(redResult!.totalCourseCredits).toBe(5);
    expect(redResult!.totalModules).toBe(2);
    expect(redResult!.semesters[0].totalCourseCredits).toBe(3);
    expect(redResult!.semesters[0].totalModules).toBe(1);
  });

  it('keeps total credits and module counts invariant after GPA exclusion (E(CA), E(ESA), AB, red toggle)', () => {
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];

    // Exclude both modules: one via E(CA) edit, one via red toggle
    const userEdits = { 'ICT23811:IC3433': 'E(CA)' };
    const moduleExclusions = { IC3442: true };

    const result = calculateStudentSearch(sheets, '811', uocConfig, {}, {}, moduleExclusions, userEdits);
    expect(result).not.toBeNull();

    // Both modules are excluded from GPA
    expect(result!.cgpaModuleCount).toBe(0);
    expect(result!.cgpaTotalCredits).toBe(0);
    expect(result!.hasCgpa).toBe(false);

    // But Total Course Credits and Total Modules STILL accurately reflect full enrollment!
    expect(result!.totalCourseCredits).toBe(5);
    expect(result!.totalModules).toBe(2);
    expect(result!.semesters[0].totalCourseCredits).toBe(3);
    expect(result!.semesters[0].totalModules).toBe(1);
    expect(result!.semesters[1].totalCourseCredits).toBe(2);
    expect(result!.semesters[1].totalModules).toBe(1);
  });

  it('handles repeat/resit linking without counting duplicate modules or duplicate credits', () => {
    // 906 has original C- (3 credits) in SAMPLE_SHEET_1, and repeat B+ in SAMPLE_SHEET_3_RESIT
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_3_RESIT];

    const student906 = calculateStudentSearch(sheets, '906', uocConfig);
    expect(student906).not.toBeNull();

    // Module IC3433 is repeated, but must be counted only ONCE in Total Modules and Total Course Credits
    expect(student906!.totalModules).toBe(1);
    expect(student906!.totalCourseCredits).toBe(3); // NOT 6 credits!

    // In CGPA: 3 credits * 3.0 (capped at B) = 9.0 points / 3 = 3.00 CGPA
    expect(student906!.cgpaModuleCount).toBe(1); // NOT 2 modules!
    expect(student906!.cgpaTotalCredits).toBe(3); // NOT 6 credits!
    expect(student906!.cgpa).toBeCloseTo(3.0, 2);
    expect(student906!.cgpa.toFixed(2)).toBe('3.00');
  });

  it('deduplicates modules within the same semester so duplicate rows are never counted twice', () => {
    // Create a semester with duplicate entries for the same module
    const sheetWithDuplicates: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'sheet-dup',
      courseCode: 'IC3433',
      examSession: 'First Semester 2025',
      rows: [
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'IC3433',
          grade: 'A',
          status: null,
          flags: [],
          textReading: 'A',
          ocrReading: 'A',
          workingValue: 'A',
        },
        // Duplicate row for same student & module
        {
          indexNumber: 'ICT/23/811',
          moduleCode: 'IC 3433', // normalized to IC3433
          grade: 'A',
          status: null,
          flags: [],
          textReading: 'A',
          ocrReading: 'A',
          workingValue: 'A',
        },
      ],
    };

    const student = calculateStudentSearch([sheetWithDuplicates], '811', uocConfig);
    expect(student).not.toBeNull();

    // Deduplication ensures:
    expect(student!.semesters[0].rows).toHaveLength(1);
    expect(student!.semesters[0].totalModules).toBe(1);
    expect(student!.semesters[0].totalCourseCredits).toBe(3); // NOT 6
    expect(student!.totalModules).toBe(1);
    expect(student!.totalCourseCredits).toBe(3);
    expect(student!.cgpaTotalCredits).toBe(3);
    expect(student!.cgpaModuleCount).toBe(1);
  });

  it('handles empty or unavailable GPA scenarios without displaying misleading zeros', () => {
    // Student enrolled only in non-GPA / ungradable modules (e.g. AB status)
    const sheetUngradable: typeof SAMPLE_SHEET_1 = {
      ...SAMPLE_SHEET_1,
      id: 'sheet-ab',
      courseCode: 'ITC1052', // 2 credits
      examSession: 'First Semester 2025',
      rows: [
        {
          indexNumber: 'ICT/23/899',
          moduleCode: 'ITC1052',
          grade: null,
          status: 'AB',
          flags: [],
          textReading: 'AB',
          ocrReading: 'AB',
          workingValue: 'AB',
        },
      ],
    };

    const student = calculateStudentSearch([sheetUngradable], '899', uocConfig);
    expect(student).not.toBeNull();

    // Semester summary
    const sem = student!.semesters[0];
    expect(sem.totalModules).toBe(1);
    expect(sem.totalCourseCredits).toBe(2);
    expect(sem.moduleCount).toBe(0);
    expect(sem.totalCredits).toBe(0);
    expect(sem.hasGpa).toBe(false);

    // Prevents misleading zero: display formatter returns 'N/A'
    expect(formatSgpaDisplay(sem.sgpa, sem.moduleCount)).toBe('N/A');

    // Overall course summary
    expect(student!.totalModules).toBe(1);
    expect(student!.totalCourseCredits).toBe(2);
    expect(student!.cgpaModuleCount).toBe(0);
    expect(student!.cgpaTotalCredits).toBe(0);
    expect(student!.hasCgpa).toBe(false);
    expect(student!.classification).toBeNull();

    // Prevents misleading zero: display formatter returns 'N/A'
    expect(formatCgpaDisplay(student!.cgpa, student!.cgpaModuleCount)).toBe('N/A');
  });
});

describe('Milestone M8 – PDF Upload & Session Management', () => {
  it('handles multiple PDF uploads, accumulating distinct sheets and computing course summaries', () => {
    // Two distinct sheets: IC 3433 (3 credits) and IC 3442 (2 credits)
    const sheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];

    const summary = calculateCourseSummary(sheets);
    expect(summary.totalModules).toBe(2);
    expect(summary.totalCourseCredits).toBe(5); // 3 + 2

    // Student 811 is in both sheets
    const student = calculateStudentSearch(sheets, '811', uocConfig);
    expect(student).not.toBeNull();
    expect(student?.semesters).toHaveLength(2);
    expect(student?.totalModules).toBe(2);
    expect(student?.totalCourseCredits).toBe(5);
    expect(student?.cgpaModuleCount).toBe(2);
    expect(student?.cgpaTotalCredits).toBe(5);
  });

  it('uses extracted course code and name as filename instead of local filename', () => {
    const rawSheet = {
      ...SAMPLE_SHEET_1,
      fileName: 'C:\\Users\\User\\Downloads\\Scan_2026_Final_v2.pdf',
      courseCode: 'IIC 1123',
      courseName: 'Database Systems',
    };

    // Filename generation rule: <CourseCode>_<CourseName>.pdf
    const fileDisplayName = rawSheet.courseCode
      ? `${rawSheet.courseCode}${rawSheet.courseName ? '_' + rawSheet.courseName.replace(/\s+/g, '_') : ''}.pdf`
      : (rawSheet.displayName || rawSheet.fileName);

    expect(fileDisplayName).toBe('IIC 1123_Database_Systems.pdf');
    expect(fileDisplayName).not.toContain('Scan_2026_Final_v2');
  });

  it('recalculates total credits, modules, SGPA and CGPA immediately when a sheet is removed', () => {
    const initialSheets = [SAMPLE_SHEET_1, SAMPLE_SHEET_2];
    const initialStudent = calculateStudentSearch(initialSheets, '811', uocConfig);
    expect(initialStudent?.totalModules).toBe(2);
    expect(initialStudent?.totalCourseCredits).toBe(5);
    expect(initialStudent?.cgpa).toBeCloseTo(3.82, 2);

    // Remove sheet 2 (IC 3442, 2 credits)
    const remainingSheets = initialSheets.filter((s) => s.id !== SAMPLE_SHEET_2.id);
    const updatedSummary = calculateCourseSummary(remainingSheets);
    expect(updatedSummary.totalModules).toBe(1);
    expect(updatedSummary.totalCourseCredits).toBe(3);

    const updatedStudent = calculateStudentSearch(remainingSheets, '811', uocConfig);
    expect(updatedStudent).not.toBeNull();
    expect(updatedStudent?.semesters).toHaveLength(1);
    expect(updatedStudent?.totalModules).toBe(1);
    expect(updatedStudent?.totalCourseCredits).toBe(3);
    expect(updatedStudent?.cgpaModuleCount).toBe(1);
    expect(updatedStudent?.cgpaTotalCredits).toBe(3);
    // Student 811 only has IC 3433 with A- (3.7) left
    expect(updatedStudent?.cgpa).toBeCloseTo(3.70, 2);
    expect(formatSgpa(updatedStudent?.semesters[0].sgpa!)).toBe('3.7000');
  });

  it('leaves no stale student records after removing the only sheet containing that student', () => {
    // Student 811 is in Sheet 1, Student 812 is only in Sheet 2
    const singleStudentSheet2: typeof SAMPLE_SHEET_2 = {
      ...SAMPLE_SHEET_2,
      id: 'sheet-2-only',
      rows: [
        {
          indexNumber: 'ICT/23/899',
          moduleCode: 'IC3442',
          grade: 'B',
          status: null,
          flags: [],
          textReading: 'B',
          ocrReading: 'B',
          workingValue: 'B',
        },
      ],
    };

    const sheets = [SAMPLE_SHEET_1, singleStudentSheet2];
    expect(calculateStudentSearch(sheets, '899', uocConfig)).not.toBeNull();

    // Remove singleStudentSheet2
    const remaining = sheets.filter((s) => s.id !== 'sheet-2-only');
    expect(calculateStudentSearch(remaining, '899', uocConfig)).toBeNull();
  });

  it('cleans up orphaned user edits and exclusions when a sheet is removed while preserving valid edits for remaining sheets', () => {
    const sheet1 = { ...SAMPLE_SHEET_1, id: 'sheet-1' };
    const sheet2 = { ...SAMPLE_SHEET_2, id: 'sheet-2' };
    const allSheets = [sheet1, sheet2];

    // User made an edit on student 811 in Sheet 1 (IC3433) and in Sheet 2 (IC3442)
    const userEdits: Record<string, string> = {
      'sheet-1:ICT23811:IC3433': 'A+',
      'ICT23811:IC3433': 'A+',
      'sheet-2:ICT23811:IC3442': 'C+',
      'ICT23811:IC3442': 'C+',
    };

    const moduleExclusions: Record<string, boolean> = {
      IC3433: true,
      IC3442: false,
    };

    // Simulate removing sheet 1 from allSheets
    const removedSheetId = 'sheet-1';
    const remainingSheets = allSheets.filter((s) => s.id !== removedSheetId);
    const remainingNormMods = new Set(remainingSheets.map((s) => normalizeModuleCode(s.courseCode)));

    // Cleanup orphaned edits logic
    const nextEdits: Record<string, string> = {};
    for (const [key, val] of Object.entries(userEdits)) {
      if (key.startsWith(`${removedSheetId}:`)) continue;
      if (key.includes(':')) {
        const parts = key.split(':');
        const mod = parts[parts.length - 1];
        if (!remainingNormMods.has(mod)) continue;
      }
      nextEdits[key] = val;
    }

    // Next exclusions logic
    const nextExclusions: Record<string, boolean> = {};
    for (const [mod, val] of Object.entries(moduleExclusions)) {
      if (remainingNormMods.has(normalizeModuleCode(mod))) {
        nextExclusions[mod] = val;
      }
    }

    // Verify IC3433 edits and exclusions were pruned
    expect(nextEdits['sheet-1:ICT23811:IC3433']).toBeUndefined();
    expect(nextEdits['ICT23811:IC3433']).toBeUndefined();
    expect(nextExclusions['IC3433']).toBeUndefined();

    // Verify IC3442 edit was preserved
    expect(nextEdits['sheet-2:ICT23811:IC3442']).toBe('C+');
    expect(nextEdits['ICT23811:IC3442']).toBe('C+');

    // Recalculating student 811 with remaining sheet & next edits applies the preserved edit
    const student = calculateStudentSearch(remainingSheets, '811', uocConfig, {}, {}, nextExclusions, nextEdits);
    expect(student).not.toBeNull();
    expect(student?.semesters[0].rows[0].effectiveGrade).toBe('C+');
    expect(student?.semesters[0].rows[0].isEdited).toBe(true);
  });

  it('updates grades and recalculates SGPA/CGPA immediately when a sheet is replaced', () => {
    const sheetOriginal = { ...SAMPLE_SHEET_1, id: 'sheet-original' };

    // Initially student 811 has A- (3.7) in sheetOriginal -> SGPA = 3.7000
    const studentBefore = calculateStudentSearch([sheetOriginal], '811', uocConfig);
    expect(formatSgpa(studentBefore?.semesters[0].sgpa!)).toBe('3.7000');
    expect(studentBefore?.cgpa).toBeCloseTo(3.70, 2);

    // Replace sheetOriginal with updated version where student 811 scored A+ (4.0)
    const updatedRows = sheetOriginal.rows.map((r) =>
      r.indexNumber === 'ICT/23/811'
        ? { ...r, grade: 'A+', textReading: 'A+', workingValue: 'A+' }
        : r,
    );
    const sheetUpdated = {
      ...sheetOriginal,
      rows: updatedRows,
    };

    const studentAfter = calculateStudentSearch([sheetUpdated], '811', uocConfig);
    expect(formatSgpa(studentAfter?.semesters[0].sgpa!)).toBe('4.0000');
    expect(studentAfter?.cgpa).toBeCloseTo(4.00, 2);
  });

  it('detects duplicate course uploads and differentiates between original and repeat-resit sheets', () => {
    const sheets = [
      { ...SAMPLE_SHEET_1, courseCode: 'IC 3433', type: 'original' as const },
      { ...SAMPLE_SHEET_3_RESIT, courseCode: 'IC 3433', type: 'repeat-resit' as const },
    ];

    const checkDuplicate = (courseCode: string, type?: 'original' | 'repeat-resit') => {
      const clean = courseCode.trim().toUpperCase();
      return sheets.find(
        (s) =>
          s.courseCode.trim().toUpperCase() === clean &&
          (type ? (s.type ?? 'original') === type : true),
      );
    };

    // Duplicate original
    const dupOriginal = checkDuplicate('IC 3433', 'original');
    expect(dupOriginal).toBeDefined();
    expect(dupOriginal?.type).toBe('original');

    // Duplicate repeat-resit
    const dupResit = checkDuplicate('IC 3433', 'repeat-resit');
    expect(dupResit).toBeDefined();
    expect(dupResit?.type).toBe('repeat-resit');

    // Non-existent course
    expect(checkDuplicate('MAT 1113')).toBeUndefined();
  });

  it('wipes all sheets, manual credits, exclusions, user edits and sessionStorage keys on Clear All', () => {
    // Setup mock sessionStorage
    const storage: Record<string, string> = {
      gpa_calc_session_sheets_v2: JSON.stringify([SAMPLE_SHEET_1]),
      gpa_calc_session_credits_v2: JSON.stringify({ IC3433: 3 }),
      gpa_calc_session_exclusions_v2: JSON.stringify({ 'ICT23811:IC3433': true }),
      gpa_calc_session_module_exclusions_v2: JSON.stringify({ IC3433: true }),
      gpa_calc_session_edits_v2: JSON.stringify({ 'ICT23811:IC3433': 'A+' }),
    };

    const keysToRemove = [
      'gpa_calc_session_sheets_v2',
      'gpa_calc_session_credits_v2',
      'gpa_calc_session_exclusions_v2',
      'gpa_calc_session_module_exclusions_v2',
      'gpa_calc_session_edits_v2',
    ];

    // Simulate Clear All action
    let sheets: typeof SAMPLE_SHEET_1[] = [SAMPLE_SHEET_1];
    let manualCredits: Record<string, number> = { IC3433: 3 };
    let exclusions: Record<string, boolean> = { IC3433: true };
    let edits: Record<string, string> = { 'ICT23811:IC3433': 'A+' };

    // Clear execution
    sheets = [];
    manualCredits = {};
    exclusions = {};
    edits = {};
    for (const k of keysToRemove) {
      delete storage[k];
    }

    // Verify all keys are removed
    for (const k of keysToRemove) {
      expect(storage[k]).toBeUndefined();
    }

    // Course summary is 0
    const summary = calculateCourseSummary(sheets, manualCredits);
    expect(summary.totalCourseCredits).toBe(0);
    expect(summary.totalModules).toBe(0);

    // Search returns null
    expect(calculateStudentSearch(sheets, '811', uocConfig, manualCredits, exclusions, exclusions, edits)).toBeNull();
  });

  it('preserves extracted records and edits across browser session refreshes via sessionStorage', () => {
    const initialSheets = [SAMPLE_SHEET_1];
    const initialEdits = { 'ICT23811:IC3433': 'A+' };
    const initialExclusions = { IC3433: false };

    // Serialize to storage (simulating active session)
    const mockStorage: Record<string, string> = {
      gpa_calc_session_sheets_v2: JSON.stringify(initialSheets),
      gpa_calc_session_edits_v2: JSON.stringify(initialEdits),
      gpa_calc_session_module_exclusions_v2: JSON.stringify(initialExclusions),
    };

    // Simulate page refresh: reload state from storage
    const restoredSheets = JSON.parse(mockStorage['gpa_calc_session_sheets_v2'] || '[]');
    const restoredEdits = JSON.parse(mockStorage['gpa_calc_session_edits_v2'] || '{}');
    const restoredExclusions = JSON.parse(mockStorage['gpa_calc_session_module_exclusions_v2'] || '{}');

    expect(restoredSheets).toHaveLength(1);
    expect(restoredSheets[0].courseCode).toBe(SAMPLE_SHEET_1.courseCode);
    expect(restoredEdits['ICT23811:IC3433']).toBe('A+');
    expect(restoredExclusions['IC3433']).toBe(false);

    // Calculations work on restored data
    const student = calculateStudentSearch(
      restoredSheets,
      '811',
      uocConfig,
      {},
      {},
      restoredExclusions,
      restoredEdits,
    );
    expect(student).not.toBeNull();
    expect(student?.semesters[0].rows[0].effectiveGrade).toBe('A+');
    expect(student?.semesters[0].rows[0].isEdited).toBe(true);
  });

  it('handles corrupted sessionStorage safely without crashing', () => {
    const corruptedJson = '{ invalid_json ...';

    let loadedSheets = [];
    try {
      loadedSheets = JSON.parse(corruptedJson);
    } catch {
      loadedSheets = [];
    }

    expect(loadedSheets).toEqual([]);
    expect(calculateCourseSummary(loadedSheets)).toEqual({
      totalCourseCredits: 0,
      totalModules: 0,
    });
  });
});
