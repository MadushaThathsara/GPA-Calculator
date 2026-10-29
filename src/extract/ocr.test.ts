/**
 * extract/ocr.test.ts
 *
 * Tests for OCR worker initialization, asset resolution, spatial clustering,
 * result extraction, and format handling.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveTesseractPaths,
  wordCentreX,
  wordCentreY,
  groupOcrWordsIntoRows,
  runOcrOnPages,
  type OcrWord,
} from './ocr';
import { parseCellValue, normaliseIndexNumber } from './parseStatus';
import { extractOcrGrade, buildTextRowsFromOcr } from './reconcile';
import { parseHeaderFromText } from './pdfText';

function makeOcrWord(
  text: string,
  x0: number,
  y0: number,
  x1 = x0 + text.length * 8,
  y1 = y0 + 14,
  confidence = 90,
): OcrWord {
  return {
    text,
    confidence,
    bbox: { x0, y0, x1, y1 },
  };
}

describe('Tesseract asset and path resolution', () => {
  it('resolves relative /tesseract/ base with provided origin', () => {
    const paths = resolveTesseractPaths('/tesseract/', 'http://localhost:5173');
    expect(paths.workerPath).toBe('http://localhost:5173/tesseract/worker.min.js');
    expect(paths.corePath).toBe('http://localhost:5173/tesseract/tesseract-core-simd.wasm.js');
    expect(paths.langPath).toBe('http://localhost:5173/tesseract/');
  });

  it('resolves custom relative base without leading slash', () => {
    const paths = resolveTesseractPaths('assets/ocr', 'https://example.edu');
    expect(paths.workerPath).toBe('https://example.edu/assets/ocr/worker.min.js');
    expect(paths.corePath).toBe('https://example.edu/assets/ocr/tesseract-core-simd.wasm.js');
    expect(paths.langPath).toBe('https://example.edu/assets/ocr/');
  });

  it('preserves absolute URLs for CDN or remote assets', () => {
    const paths = resolveTesseractPaths('https://cdn.example.com/tesseract/');
    expect(paths.workerPath).toBe('https://cdn.example.com/tesseract/worker.min.js');
    expect(paths.corePath).toBe('https://cdn.example.com/tesseract/tesseract-core-simd.wasm.js');
    expect(paths.langPath).toBe('https://cdn.example.com/tesseract/');
  });
});

describe('OCR word spatial helpers', () => {
  it('computes bounding box centres accurately', () => {
    const word = makeOcrWord('ICT', 10, 20, 30, 40);
    expect(wordCentreX(word)).toBe(20);
    expect(wordCentreY(word)).toBe(30);
  });

  it('groups words into rows by y-proximity and sorts left-to-right', () => {
    const w1 = makeOcrWord('ICT/23/811', 50, 100);
    const w2 = makeOcrWord('A-', 200, 102); // same line (diff y = 2)
    const w3 = makeOcrWord('ICT/23/812', 50, 150); // next line (diff y = 50)
    const w4 = makeOcrWord('B', 200, 148);

    const rows = groupOcrWordsIntoRows([w2, w4, w1, w3], 20);
    expect(rows).toHaveLength(2);
    expect(rows[0].map((w) => w.text)).toEqual(['ICT/23/811', 'A-']);
    expect(rows[1].map((w) => w.text)).toEqual(['ICT/23/812', 'B']);
  });
});

describe('Preserving minus signs in grades (A-, B-, C-)', () => {
  it('parses grades with trailing space before minus: "A -"', () => {
    const parsed = parseCellValue('A -');
    expect(parsed.grade).toBe('A-');
    expect(parsed.unknown).toBe(false);
  });

  it('parses grades with unicode en-dash: "A–"', () => {
    const parsed = parseCellValue('A\u2013');
    expect(parsed.grade).toBe('A-');
    expect(parsed.unknown).toBe(false);
  });

  it('parses grades with unicode em-dash: "B—"', () => {
    const parsed = parseCellValue('B\u2014');
    expect(parsed.grade).toBe('B-');
    expect(parsed.unknown).toBe(false);
  });

  it('parses grades with unicode minus sign: "C −"', () => {
    const parsed = parseCellValue('C \u2212');
    expect(parsed.grade).toBe('C-');
    expect(parsed.unknown).toBe(false);
  });

  it('recovers 2-word split grades in extractOcrGrade: ["A", "-"]', () => {
    const idxWord = makeOcrWord('ICT/23/811', 50, 100);
    const letterWord = makeOcrWord('A', 200, 100);
    const minusWord = makeOcrWord('-', 210, 100);

    const grade = extractOcrGrade([idxWord, letterWord, minusWord]);
    expect(grade).toBe('A-');
  });
});

describe('OCR student index normalisation and prefix recovery', () => {
  it('normalises standard ICT/23/815', () => {
    expect(normaliseIndexNumber('ICT/23/815')).toBe('ICT/23/815');
  });

  it('recovers dropped leading I in CT23815', () => {
    expect(normaliseIndexNumber('CT23815')).toBe('ICT/23/815');
    expect(normaliseIndexNumber('CT 23815')).toBe('ICT/23/815');
    expect(normaliseIndexNumber('CT 23 841')).toBe('ICT/23/841');
  });

  it('recovers misrecognized leading I as pipe or slash: "|CT/23/815" or "/CT/23/815"', () => {
    expect(normaliseIndexNumber('|CT/23/815')).toBe('ICT/23/815');
    expect(normaliseIndexNumber('/CT/23/815')).toBe('ICT/23/815');
    expect(normaliseIndexNumber('1CT/23/815')).toBe('ICT/23/815');
    expect(normaliseIndexNumber('lCT/23/815')).toBe('ICT/23/815');
  });

  it('normalises multi-column OCR lines in buildTextRowsFromOcr', () => {
    // Two students side-by-side in one line cluster
    const col1Idx = makeOcrWord('CT 23815', 50, 100);
    const col1Grade = makeOcrWord('A', 200, 100);
    const col2Idx = makeOcrWord('CT 23 841', 400, 100);
    const col2Grade = makeOcrWord('B+', 550, 100);

    const textRows = buildTextRowsFromOcr([col1Idx, col1Grade, col2Idx, col2Grade]);
    expect(textRows).toHaveLength(2);
    expect(textRows[0].indexNumber).toBe('ICT/23/815');
    expect(textRows[0].textGradeOrStatus).toBe('A');
    expect(textRows[1].indexNumber).toBe('ICT/23/841');
    expect(textRows[1].textGradeOrStatus).toBe('B+');
  });
});

describe('Header parsing from OCR text', () => {
  it('extracts course code, name, and exam session from OCR text block', () => {
    const ocrSample = `
      UNIVERSITY OF SRI JAYEWARDENEPURA
      FACULTY OF TECHNOLOGY
      Second Semester Examination 2024/2025
      ITC 2252 Introduction to Machine Learning
      October 2024
      ICT/23/811 A
    `;
    const header = parseHeaderFromText(ocrSample);
    expect(header.courseCode).toBe('ITC2252');
    expect(header.courseName).toBe('Introduction to Machine Learning');
    expect(header.examSession).toBe('Second Semester Examination 2024/2025');
  });
});

describe('runOcrOnPages edge cases and cancellation', () => {
  it('returns empty array when pages array is empty', async () => {
    const results = await runOcrOnPages([]);
    expect(results).toEqual([]);
  });

  it('aborts immediately when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runOcrOnPages(
        [{ pageNumber: 1, imageUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });
});

