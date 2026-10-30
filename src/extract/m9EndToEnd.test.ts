/**
 * extract/m9EndToEnd.test.ts
 *
 * M9: Comprehensive End-to-End Testing & Accuracy Verification.
 * Tests realistic University of Sri Jayewardenepura (USJ) examination PDFs:
 *  1. Real PDF extraction accuracy, header metadata, and course name extraction.
 *  2. Student count validation and page-by-page regression (e.g. IIC 1123: 153 students).
 *  3. Semester and academic year detection from headings and module codes.
 *  4. Credit and GPA calculation accuracy against official student records (ICT/23/802).
 *  5. Green/red dot module exclusion and E(ESA)/E(CA) exclusion from GPA.
 *  6. Grade editing and session management (editing, replacement, removal, Clear All).
 *  7. Repeat/resit linking, capping, and multi-resit handling.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  groupItemsIntoRows,
  rowToString,
  parseSheetHeader,
  extractPrintedTotal,
  normaliseIndexNumber,
  type PdfTextItem,
} from './pdfText';
import { extractTextLayerRows } from './reconcile';
import {
  calculateStudentSearch,
  type MockSheet,
  type MockResultRow,
} from '../store/useSessionStore';
import { formatSgpa, formatCgpaDisplay } from '../engine/gpa';
import uocConfig from '../rules/universities/uoc';

describe('Milestone M9 – End-to-End Testing & Real PDF Accuracy', () => {
  const baseDir = 'D:/Campus Lecture/Result';

  // Helper to extract a mock sheet from a real PDF file
  async function extractSheetFromPdf(relPath: string): Promise<MockSheet> {
    const fullPath = path.join(baseDir, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`PDF file not found: ${fullPath}`);
    }

    const data = new Uint8Array(fs.readFileSync(fullPath));
    const doc = await pdfjsLib.getDocument({ data }).promise;

    let header: any = null;
    let printedTotal: number | null = null;
    const rows: MockResultRow[] = [];
    const seen = new Set<string>();

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 2.0 });
      const textContent = await page.getTextContent();
      const items: PdfTextItem[] = (textContent.items as any[])
        .filter((it): it is { str: string; transform: number[]; width: number; height: number } => 'str' in it && typeof it.str === 'string')
        .map(it => ({
          str: it.str,
          x: it.transform[4],
          y: viewport.height / 2.0 - it.transform[5],
          width: it.width,
          height: it.height,
          fontSize: it.transform ? Math.abs(it.transform[3]) : 0,
        }));

      const pageRows = groupItemsIntoRows(items, 6);
      if (p === 1) {
        header = parseSheetHeader(pageRows);
      } else if (header && (!header.courseCode || !header.examSession)) {
        const nextH = parseSheetHeader(pageRows);
        header = {
          courseCode: header.courseCode || nextH.courseCode,
          courseName: header.courseName || nextH.courseName,
          academicYear: header.academicYear ?? nextH.academicYear,
          semesterNumber: header.semesterNumber ?? nextH.semesterNumber,
          examYear: header.examYear ?? nextH.examYear,
          examSession: header.examSession || nextH.examSession,
        };
      }

      for (const pr of pageRows) {
        const total = extractPrintedTotal(rowToString(pr));
        if (total !== null && printedTotal === null) {
          printedTotal = total;
        }
      }

      const extracted = extractTextLayerRows(pageRows);
      for (const r of extracted) {
        if (!r.indexNumber) continue;
        const norm = normaliseIndexNumber(r.indexNumber);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);

        rows.push({
          indexNumber: norm,
          moduleCode: header?.courseCode || 'UNKNOWN',
          grade: r.textGradeOrStatus && !r.textGradeOrStatus.includes('E(') && !r.textGradeOrStatus.includes('AB')
            ? r.textGradeOrStatus
            : (r.textGradeOrStatus?.startsWith('E(') ? null : (r.textGradeOrStatus || null)),
          status: r.textGradeOrStatus && (r.textGradeOrStatus.includes('E(') || r.textGradeOrStatus.includes('AB'))
            ? r.textGradeOrStatus
            : null,
          flags: [],
          textReading: r.textGradeOrStatus,
          ocrReading: null,
          workingValue: r.textGradeOrStatus || '',
        });
      }
    }

    const courseCode = header?.courseCode || 'UNKNOWN';
    const courseName = header?.courseName || path.basename(relPath, '.pdf');

    return {
      id: `sheet-${path.basename(relPath, '.pdf')}`,
      fileName: path.basename(relPath),
      displayName: `${courseCode}_${courseName.replace(/\s+/g, '_')}.pdf`,
      courseCode,
      courseName,
      academicYear: header?.academicYear ?? null,
      semesterNumber: header?.semesterNumber ?? null,
      examYear: header?.examYear ?? null,
      examSession: header?.examSession ?? null,
      rows,
      printedTotal,
      countMismatchWarning:
        printedTotal !== null && rows.length !== printedTotal
          ? `Extracted ${rows.length} students, but official PDF prints a total of ${printedTotal}.`
          : null,
    };
  }

  // ---------------------------------------------------------------------------
  // 1. Regression Test on IIC 1123 Database Systems PDF
  // ---------------------------------------------------------------------------
  it('verifies IIC 1123 Database Systems PDF extraction accuracy & counts', async () => {
    const sheet = await extractSheetFromPdf('2 nd sem Result/IIC 1123 - Database Systems.pdf');

    // Expected course metadata
    expect(sheet.courseCode).toBe('IIC1123');
    expect(sheet.courseName).toBe('Database Systems');
    expect(sheet.academicYear).toBe(1); // 1st digit of 1123 = 1
    expect(sheet.semesterNumber).toBe(2);
    expect(sheet.examSession).toBe('Second Semester Examination in 2025');

    // Expected student count
    expect(sheet.printedTotal).toBe(153);
    expect(sheet.rows).toHaveLength(153);
    expect(sheet.countMismatchWarning).toBeNull();

    // Range checks
    expect(sheet.rows[0].indexNumber).toBe('ICT/23/801');
    expect(sheet.rows[sheet.rows.length - 1].indexNumber).toBe('ICT/23/953');

    // Verify minus grades are accurately captured
    const minusGrades = sheet.rows.filter(r => r.grade && r.grade.includes('-'));
    expect(minusGrades.length).toBeGreaterThanOrEqual(40);

    // Verify benchmark student ICT/23/802 has grade B-
    const student802 = sheet.rows.find(r => r.indexNumber === 'ICT/23/802');
    expect(student802).toBeDefined();
    expect(student802?.grade).toBe('B-');
  }, 30000);

  // ---------------------------------------------------------------------------
  // 2. Real Semester 1 Extraction & GPA Calculation for Benchmark Student 802
  // ---------------------------------------------------------------------------
  it('extracts Semester 1 PDFs and calculates exact SGPA 3.8467 for student 802', async () => {
    const s1Files = [
      '1 st sem Result/Mathematics Result.pdf',
      '1 st sem Result/Physics for Technology - ITC1023.pdf',
      '1 st sem Result/ITC 1032 - Principles of Statistics.pdf',
      '1 st sem Result/V10 ITC1052 - Results-SE.pdf',
      '1 st sem Result/ITC 1063 - Fundamentals of Programming - 2024 - updated - 2025_02_23.pdf',
      '1 st sem Result/ITC 1082 Com Skills I.pdf',
      '1 st sem Result/ITC 1091 23 Ethics - New.pdf',
      '1 st sem Result/ITC1142-B23-2024-COA.pdf',
    ];

    const sheets: MockSheet[] = [];
    for (const f of s1Files) {
      sheets.push(await extractSheetFromPdf(f));
    }

    expect(sheets).toHaveLength(8);

    // Verify student 802 in Physics for Technology
    const physicsSheet = sheets.find(s => s.courseCode === 'ITC1023');
    expect(physicsSheet).toBeDefined();
    const phys802 = physicsSheet?.rows.find(r => r.indexNumber === 'ICT/23/802');
    expect(phys802?.grade).toBe('A-');

    // Exclude Non-GPA module ITC1091 (Ethical Conduct of Learners) via module exclusion (red dot)
    const moduleExclusions: Record<string, boolean> = {
      ITC1091: true,
    };

    // Calculate student search for ICT/23/802
    const student = calculateStudentSearch(sheets, '802', uocConfig, {}, {}, moduleExclusions);
    expect(student).not.toBeNull();
    expect(student?.semesters).toHaveLength(1);

    const sem1 = student!.semesters[0];

    // Total Course Credits = 3 (Math) + 3 (Physics) + 2 (Stats) + 2 (SE) + 3 (Prog) + 2 (ComSkills) + 1 (Ethics) + 2 (COA) = 18 credits
    // Total Modules = 8 modules (includes both GPA and Non-GPA)
    expect(sem1.totalModules).toBe(8);
    expect(sem1.totalCourseCredits).toBe(18);

    // Verify student 802's Software Engineering I has E(ESA) and is EXCLUDED from GPA
    const seRow = sem1.rows.find(r => r.row.moduleCode === 'ITC1052');
    expect(seRow).toBeDefined();
    expect(seRow?.originalStatus).toBe('E(ESA)');
    expect(seRow?.excluded).toBe(true);

    // Verify student 802's Ethics module is marked excluded due to red dot
    const ethicsRow = sem1.rows.find(r => r.row.moduleCode === 'ITC1091');
    expect(ethicsRow).toBeDefined();
    expect(ethicsRow?.isUserExcluded).toBe(true);
    expect(ethicsRow?.excluded).toBe(true);

    // Active GPA modules count = 6 modules (Math, Physics, Stats, Prog, ComSkills, COA)
    // Active GPA credits = 3 + 3 + 2 + 3 + 2 + 2 = 15 credits
    // Total GPA points for student 802:
    // Math: 3 * 4.0 (A+) = 12.0
    // Physics: 3 * 3.7 (A-) = 11.1
    // Stats: 2 * 4.0 (A) = 8.0
    // Prog: 3 * 4.0 (A) = 12.0
    // ComSkills: 2 * 4.0 (A) = 8.0
    // COA: 2 * 3.3 (B+) = 6.6
    // Sum = 57.7
    // SGPA = 57.7 / 15 = 3.846666... -> 3.8467
    expect(sem1.moduleCount).toBe(6);
    expect(sem1.totalCredits).toBe(15);
    expect(formatSgpa(sem1.sgpa)).toBe('3.8467');
  }, 45000);

  // ---------------------------------------------------------------------------
  // 3. Real Semester 2 Extraction & GPA Calculation for Benchmark Student 802
  // ---------------------------------------------------------------------------
  it('extracts Semester 2 PDFs and calculates exact SGPA 3.5267 for student 802', async () => {
    const s2Files = [
      '2 nd sem Result/IIC 1123 - Database Systems.pdf',
      '2 nd sem Result/IIC1113 - Object Oriented Analysis and Design.pdf',
      '2 nd sem Result/IIC1153_OOP_2023.pdf',
      '2 nd sem Result/ISC 1092 MATH II (23).pdf',
      '2 nd sem Result/ISC 1131 Personality Development (23).pdf',
      '2 nd sem Result/ISC 1142 Com Skills II (23).pdf',
      '2 nd sem Result/Stat Methods Results Sheet Batch8 ICT (23).pdf',
    ];

    const sheets: MockSheet[] = [];
    for (const f of s2Files) {
      sheets.push(await extractSheetFromPdf(f));
    }

    expect(sheets).toHaveLength(7);

    // Exclude Non-GPA module ISC1131 (Personality Development)
    const moduleExclusions: Record<string, boolean> = {
      ISC1131: true,
    };

    const student = calculateStudentSearch(sheets, '802', uocConfig, {}, {}, moduleExclusions);
    expect(student).not.toBeNull();
    expect(student?.semesters).toHaveLength(1);

    const sem2 = student!.semesters[0];

    // Modules in Semester 2:
    // Database Systems (IIC1123): 3 cr, B- (2.7) -> 8.1
    // OOAD (IIC1113): 3 cr, A- (3.7) -> 11.1
    // OOP (IIC1153): 3 cr, A- (3.7) -> 11.1
    // Math II (ISC1092): 2 cr, A (4.0) -> 8.0
    // Com Skills II (ISC1142): 2 cr, B+ (3.3) -> 6.6
    // Stat Methods: 2 cr, A+ (4.0) -> 8.0
    // Personality Development (ISC1131): 1 cr, excluded (Non-GPA)
    // GPA Credits = 3 + 3 + 3 + 2 + 2 + 2 = 15 credits
    // Total Points = 8.1 + 11.1 + 11.1 + 8.0 + 6.6 + 8.0 = 52.9
    // SGPA = 52.9 / 15 = 3.5267
    expect(sem2.moduleCount).toBe(6);
    expect(sem2.totalCredits).toBe(15);
    expect(formatSgpa(sem2.sgpa)).toBe('3.5267');

    // Total Course Credits = 15 + 1 = 16 credits
    expect(sem2.totalCourseCredits).toBe(16);
    expect(sem2.totalModules).toBe(7);
  }, 45000);

  // ---------------------------------------------------------------------------
  // 4. Multi-Semester Cumulative CGPA & Classification across Semester 1 & 2
  // ---------------------------------------------------------------------------
  it('combines Semester 1 & 2, computing cumulative CGPA 3.69 (3.6867) and Second Class (Upper)', async () => {
    const s1Files = [
      '1 st sem Result/Mathematics Result.pdf',
      '1 st sem Result/Physics for Technology - ITC1023.pdf',
      '1 st sem Result/ITC 1032 - Principles of Statistics.pdf',
      '1 st sem Result/V10 ITC1052 - Results-SE.pdf',
      '1 st sem Result/ITC 1063 - Fundamentals of Programming - 2024 - updated - 2025_02_23.pdf',
      '1 st sem Result/ITC 1082 Com Skills I.pdf',
      '1 st sem Result/ITC 1091 23 Ethics - New.pdf',
      '1 st sem Result/ITC1142-B23-2024-COA.pdf',
    ];

    const s2Files = [
      '2 nd sem Result/IIC 1123 - Database Systems.pdf',
      '2 nd sem Result/IIC1113 - Object Oriented Analysis and Design.pdf',
      '2 nd sem Result/IIC1153_OOP_2023.pdf',
      '2 nd sem Result/ISC 1092 MATH II (23).pdf',
      '2 nd sem Result/ISC 1131 Personality Development (23).pdf',
      '2 nd sem Result/ISC 1142 Com Skills II (23).pdf',
      '2 nd sem Result/Stat Methods Results Sheet Batch8 ICT (23).pdf',
    ];

    const sheets: MockSheet[] = [];
    for (const f of [...s1Files, ...s2Files]) {
      sheets.push(await extractSheetFromPdf(f));
    }

    expect(sheets).toHaveLength(15);

    // Non-GPA module exclusions (red dot)
    const moduleExclusions: Record<string, boolean> = {
      ITC1091: true,
      ISC1131: true,
    };

    const student = calculateStudentSearch(sheets, '802', uocConfig, {}, {}, moduleExclusions);
    expect(student).not.toBeNull();
    expect(student?.semesters).toHaveLength(2);

    // Verify Sem 1 & Sem 2 individual verified benchmarks
    const sem1 = student!.semesters[0];
    const sem2 = student!.semesters[1];

    expect(sem1.semesterName).toBe('First Semester Examination in 2025');
    expect(formatSgpa(sem1.sgpa)).toBe('3.8467');
    expect(sem1.totalCredits).toBe(15);
    expect(sem1.moduleCount).toBe(6);

    expect(sem2.semesterName).toBe('Second Semester Examination in 2025');
    expect(formatSgpa(sem2.sgpa)).toBe('3.5267');
    expect(sem2.totalCredits).toBe(15);
    expect(sem2.moduleCount).toBe(6);

    // Total Course Credits = 18 (Sem 1) + 16 (Sem 2) = 34 credits
    // Total Modules = 8 (Sem 1) + 7 (Sem 2) = 15 modules
    expect(student?.totalCourseCredits).toBe(34);
    expect(student?.totalModules).toBe(15);

    // Overall Cumulative GPA Verification:
    // GPA Credits = 15 (Sem 1) + 15 (Sem 2) = 30 credits
    // Weighted Grade Points = 57.7 (Sem 1) + 52.9 (Sem 2) = 110.6 points
    // Independent CGPA = 110.6 / 30 = 3.68666... -> 3.69 (rounded to 2 decimals)
    expect(student?.cgpaTotalCredits).toBe(30);
    expect(student?.cgpaModuleCount).toBe(12);
    expect(formatCgpaDisplay(student!.cgpa, student!.cgpaModuleCount)).toBe('3.69');
    expect(student?.classification).toBe('Second Class (Upper)');
  }, 60000);

  // ---------------------------------------------------------------------------
  // 5. Grade Editing and Immediate Recalculation
  // ---------------------------------------------------------------------------
  it('tests grade editing: original value preserved, effective grade changes, and GPA updates immediately', async () => {
    const sheet = await extractSheetFromPdf('2 nd sem Result/IIC 1123 - Database Systems.pdf');

    // Student 802 initially has B- (2.7)
    const initial = calculateStudentSearch([sheet], '802', uocConfig);
    expect(initial?.semesters[0].rows[0].originalGrade).toBe('B-');
    expect(initial?.semesters[0].rows[0].effectiveGrade).toBe('B-');
    expect(formatSgpa(initial?.semesters[0].sgpa!)).toBe('2.7000');

    // Simulate user edit: change 802's grade in IIC1123 to A+
    const userEdits = {
      'ICT23802:IIC1123': 'A+',
    };

    const edited = calculateStudentSearch([sheet], '802', uocConfig, {}, {}, {}, userEdits);
    const row = edited!.semesters[0].rows[0];

    // Original extraction evidence remains untouched
    expect(row.originalGrade).toBe('B-');
    expect(row.editedValue).toBe('A+');
    expect(row.isEdited).toBe(true);
    expect(row.effectiveGrade).toBe('A+');

    // SGPA immediately recalculates with full precision
    expect(formatSgpa(edited?.semesters[0].sgpa!)).toBe('4.0000');

    // Clear edit: restores original grade and SGPA
    const cleared = calculateStudentSearch([sheet], '802', uocConfig, {}, {}, {}, {});
    expect(cleared?.semesters[0].rows[0].effectiveGrade).toBe('B-');
    expect(cleared?.semesters[0].rows[0].isEdited).toBe(false);
    expect(formatSgpa(cleared?.semesters[0].sgpa!)).toBe('2.7000');
  }, 30000);

  // ---------------------------------------------------------------------------
  // 6. Repeat/Resit Capping & Multi-Resit Rules
  // ---------------------------------------------------------------------------
  it('tests repeat/resit linking: applies cap for eligible fails, preserves uncapped for AB, credits original semester, and prevents duplicate modules', async () => {
    // Original sheet: IIC 1123 where student 803 has E(CA) & AB(ESA)
    const baseOriginalSheet = await extractSheetFromPdf('2 nd sem Result/IIC 1123 - Database Systems.pdf');

    // Add student 999 with an eligible failing grade (C-) to original sheet to test repeat cap
    const originalSheet: MockSheet = {
      ...baseOriginalSheet,
      rows: [
        ...baseOriginalSheet.rows,
        {
          indexNumber: 'ICT/23/999',
          moduleCode: 'IIC1123',
          grade: 'C-',
          status: null,
          flags: [],
          textReading: 'C-',
          ocrReading: 'C-',
          workingValue: 'C-',
        },
      ],
    };

    // Repeat sheet for IIC 1123 with repeat results for student 803 and student 999
    const repeatSheet: MockSheet = {
      ...originalSheet,
      id: 'sheet-iic1123-resit',
      type: 'repeat-resit',
      examSession: 'First Semester Examination in 2026',
      rows: [
        {
          indexNumber: 'ICT/23/803',
          moduleCode: 'IIC1123',
          grade: 'A',
          status: null,
          flags: [],
          textReading: 'A',
          ocrReading: 'A',
          workingValue: 'A',
        },
        {
          indexNumber: 'ICT/23/999',
          moduleCode: 'IIC1123',
          grade: 'A',
          status: null,
          flags: [],
          textReading: 'A',
          ocrReading: 'A',
          workingValue: 'A',
        },
      ],
    };

    // 1. Student 803: AB-related original result ('E(CA) & AB(ESA)') -> UNCAPPED (capped: false, effectiveGrade: 'A')
    const student803 = calculateStudentSearch([originalSheet, repeatSheet], '803', uocConfig);
    expect(student803).not.toBeNull();
    expect(student803?.semesters).toHaveLength(1);
    expect(student803?.semesters[0].semesterName).toBe('Second Semester Examination in 2025');

    const row803 = student803!.semesters[0].rows[0];
    expect(row803.originalStatus).toBe('E(CA) & AB(ESA)');
    expect(row803.resitInfo).toBeDefined();
    expect(row803.resitInfo?.capped).toBe(false);
    expect(row803.resitInfo?.repeatGrade).toBe('A');
    expect(row803.effectiveGrade).toBe('A');

    // 2. Student 999: Eligible failing grade ('C-') -> CAPPED at B (capped: true, effectiveGrade: 'B')
    const student999 = calculateStudentSearch([originalSheet, repeatSheet], '999', uocConfig);
    expect(student999).not.toBeNull();
    expect(student999?.semesters).toHaveLength(1);
    expect(student999?.semesters[0].semesterName).toBe('Second Semester Examination in 2025');

    const row999 = student999!.semesters[0].rows[0];
    expect(row999.originalGrade).toBe('C-');
    expect(row999.resitInfo).toBeDefined();
    expect(row999.resitInfo?.capped).toBe(true);
    expect(row999.resitInfo?.repeatGrade).toBe('A');
    expect(row999.effectiveGrade).toBe('B');

    // 3. Ensure credits and modules are NOT double counted
    expect(student803?.totalModules).toBe(1);
    expect(student803?.totalCourseCredits).toBe(3);
    expect(student803?.cgpaTotalCredits).toBe(3);
    expect(student803?.cgpaModuleCount).toBe(1);

    expect(student999?.totalModules).toBe(1);
    expect(student999?.totalCourseCredits).toBe(3);
    expect(student999?.cgpaTotalCredits).toBe(3);
    expect(student999?.cgpaModuleCount).toBe(1);
  }, 30000);

  // ---------------------------------------------------------------------------
  // 7. Part 2 Verification: E(CA) and E(ESA) Repeat Scenarios & Recalculation
  // ---------------------------------------------------------------------------
  it('verifies all 7 Part 2 E(CA) / E(ESA) repeat scenarios in end-to-end session calculation', async () => {
    // Base semester 1 sheet with ITC 1052 (2 credits)
    const baseSheet = await extractSheetFromPdf('1 st sem Result/V10 ITC1052 - Results-SE.pdf');

    // Create synthetic student rows for the scenarios
    const originalSheet: MockSheet = {
      ...baseSheet,
      rows: [
        // S1: E(CA) -> repeat A
        { indexNumber: 'ICT/23/701', moduleCode: 'ITC1052', grade: null, status: 'E(CA)', flags: [], textReading: 'E(CA)', ocrReading: null, workingValue: 'E(CA)' },
        // S2: E(CA) -> repeat B+
        { indexNumber: 'ICT/23/702', moduleCode: 'ITC1052', grade: null, status: 'E(CA)', flags: [], textReading: 'E(CA)', ocrReading: null, workingValue: 'E(CA)' },
        // S3: E(CA) -> repeat B
        { indexNumber: 'ICT/23/703', moduleCode: 'ITC1052', grade: null, status: 'E(CA)', flags: [], textReading: 'E(CA)', ocrReading: null, workingValue: 'E(CA)' },
        // S4: E(CA) -> repeat C+
        { indexNumber: 'ICT/23/704', moduleCode: 'ITC1052', grade: null, status: 'E(CA)', flags: [], textReading: 'E(CA)', ocrReading: null, workingValue: 'E(CA)' },
        // S5: E(CA) -> repeat AB
        { indexNumber: 'ICT/23/705', moduleCode: 'ITC1052', grade: null, status: 'E(CA)', flags: [], textReading: 'E(CA)', ocrReading: null, workingValue: 'E(CA)' },
        // S6: E(ESA) -> repeat A
        { indexNumber: 'ICT/23/706', moduleCode: 'ITC1052', grade: null, status: 'E(ESA)', flags: [], textReading: 'E(ESA)', ocrReading: null, workingValue: 'E(ESA)' },
        // S7: E(CA) without repeat
        { indexNumber: 'ICT/23/707', moduleCode: 'ITC1052', grade: null, status: 'E(CA)', flags: [], textReading: 'E(CA)', ocrReading: null, workingValue: 'E(CA)' },
      ],
    };

    // Repeat sheet (simulating repeat examination in subsequent session)
    const repeatSheet: MockSheet = {
      ...originalSheet,
      id: 'sheet-itc1052-repeat',
      type: 'repeat-resit',
      examSession: 'First Semester Examination in 2026',
      rows: [
        { indexNumber: 'ICT/23/701', moduleCode: 'ITC1052', grade: 'A', status: null, flags: [], textReading: 'A', ocrReading: null, workingValue: 'A' },
        { indexNumber: 'ICT/23/702', moduleCode: 'ITC1052', grade: 'B+', status: null, flags: [], textReading: 'B+', ocrReading: null, workingValue: 'B+' },
        { indexNumber: 'ICT/23/703', moduleCode: 'ITC1052', grade: 'B', status: null, flags: [], textReading: 'B', ocrReading: null, workingValue: 'B' },
        { indexNumber: 'ICT/23/704', moduleCode: 'ITC1052', grade: 'C+', status: null, flags: [], textReading: 'C+', ocrReading: null, workingValue: 'C+' },
        { indexNumber: 'ICT/23/705', moduleCode: 'ITC1052', grade: null, status: 'AB', flags: [], textReading: 'AB', ocrReading: null, workingValue: 'AB' },
        { indexNumber: 'ICT/23/706', moduleCode: 'ITC1052', grade: 'A', status: null, flags: [], textReading: 'A', ocrReading: null, workingValue: 'A' },
        // 707 has no repeat row
      ],
    };

    const sheets = [originalSheet, repeatSheet];

    // Scenario 1: Original E(CA) + repeat A -> B (3.0, capped)
    const s1 = calculateStudentSearch(sheets, '701', uocConfig);
    expect(s1).not.toBeNull();
    expect(s1!.semesters[0].rows[0].originalStatus).toBe('E(CA)');
    expect(s1!.semesters[0].rows[0].resitInfo?.repeatGrade).toBe('A');
    expect(s1!.semesters[0].rows[0].resitInfo?.capped).toBe(true);
    expect(s1!.semesters[0].rows[0].effectiveGrade).toBe('B');
    expect(formatSgpa(s1!.semesters[0].sgpa)).toBe('3.0000');
    expect(s1!.cgpaTotalCredits).toBe(2);
    expect(s1!.totalCourseCredits).toBe(2);
    expect(s1!.totalModules).toBe(1);

    // Scenario 2: Original E(CA) + repeat B+ -> B (3.0, capped)
    const s2 = calculateStudentSearch(sheets, '702', uocConfig);
    expect(s2!.semesters[0].rows[0].resitInfo?.capped).toBe(true);
    expect(s2!.semesters[0].rows[0].effectiveGrade).toBe('B');
    expect(formatSgpa(s2!.semesters[0].sgpa)).toBe('3.0000');

    // Scenario 3: Original E(CA) + repeat B -> B (3.0, uncapped)
    const s3 = calculateStudentSearch(sheets, '703', uocConfig);
    expect(s3!.semesters[0].rows[0].resitInfo?.capped).toBe(false);
    expect(s3!.semesters[0].rows[0].effectiveGrade).toBe('B');
    expect(formatSgpa(s3!.semesters[0].sgpa)).toBe('3.0000');

    // Scenario 4: Original E(CA) + repeat C+ -> C+ (2.3, actual grade)
    const s4 = calculateStudentSearch(sheets, '704', uocConfig);
    expect(s4!.semesters[0].rows[0].resitInfo?.capped).toBe(false);
    expect(s4!.semesters[0].rows[0].effectiveGrade).toBe('C+');
    expect(formatSgpa(s4!.semesters[0].sgpa)).toBe('2.3000');

    // Scenario 5: Original E(CA) + repeat AB -> original E(CA) remains effective and excluded
    const s5 = calculateStudentSearch(sheets, '705', uocConfig);
    expect(s5!.semesters[0].rows[0].originalStatus).toBe('E(CA)');
    expect(s5!.semesters[0].rows[0].effectiveGrade).toBeNull();
    expect(s5!.semesters[0].rows[0].excluded).toBe(true);
    expect(s5!.semesters[0].moduleCount).toBe(0);
    expect(s5!.semesters[0].totalCredits).toBe(0); // 0 GPA credits
    expect(s5!.totalCourseCredits).toBe(2); // retained in total course credits

    // Scenario 6: Original E(ESA) + repeat A -> B (3.0, capped)
    const s6 = calculateStudentSearch(sheets, '706', uocConfig);
    expect(s6!.semesters[0].rows[0].originalStatus).toBe('E(ESA)');
    expect(s6!.semesters[0].rows[0].resitInfo?.capped).toBe(true);
    expect(s6!.semesters[0].rows[0].effectiveGrade).toBe('B');
    expect(formatSgpa(s6!.semesters[0].sgpa)).toBe('3.0000');

    // Scenario 7: Original E(CA) without repeat -> excluded from GPA
    const s7 = calculateStudentSearch(sheets, '707', uocConfig);
    expect(s7!.semesters[0].rows[0].originalStatus).toBe('E(CA)');
    expect(s7!.semesters[0].rows[0].resitInfo).toBeUndefined();
    expect(s7!.semesters[0].rows[0].effectiveGrade).toBeNull();
    expect(s7!.semesters[0].rows[0].excluded).toBe(true);
    expect(s7!.semesters[0].moduleCount).toBe(0);
    expect(s7!.semesters[0].totalCredits).toBe(0);
    expect(s7!.totalCourseCredits).toBe(2);
    expect(s7!.totalModules).toBe(1);
  }, 30000);
});
