import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import Tesseract from 'tesseract.js';
import { normaliseIndexNumber, groupItemsIntoRows } from './pdfText';
import { extractTextLayerRows, reconcilePage, buildTextRowsFromOcr } from './reconcile';

describe('inspect 1123 pdf', () => {
  it('traces full pipeline including OCR on real PDF', async () => {
    const pdfPath = 'D:/Campus Lecture/Result/2 nd sem Result/IIC 1123 - Database Systems.pdf';
    if (!fs.existsSync(pdfPath)) {
      console.log('PDF does not exist at', pdfPath);
      return;
    }
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const doc = await pdfjsLib.getDocument({ data }).promise;

    const worker = await Tesseract.createWorker('eng', 1, {
      langPath: path.resolve('public/tesseract'),
    });

    const allRows: any[] = [];
    const seenIndices = new Map<string, any>();

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      await page.render({ canvasContext: ctx as any, viewport }).promise;
      const pngBuffer = canvas.toBuffer('image/png');

      const textContent = await page.getTextContent();
      const items = (textContent.items as any[])
        .filter((it): it is { str: string; transform: number[]; width: number; height: number } => 'str' in it && typeof it.str === 'string')
        .map(it => ({
          str: it.str,
          x: it.transform[4],
          y: viewport.height / 2.0 - it.transform[5],
          width: it.width,
          height: it.height,
          fontSize: it.transform ? Math.abs(it.transform[3]) : 0,
        }));

      const rows = groupItemsIntoRows(items, 6);
      const textRows = extractTextLayerRows(rows);

      const ocrRes = await worker.recognize(pngBuffer);
      const ocrWords = ocrRes.data.words.map(w => ({
        text: w.text,
        confidence: w.confidence,
        bbox: w.bbox,
      }));

      const ocrCands = buildTextRowsFromOcr(ocrWords, 2.0);
      console.log(`Page ${pageNum}: textRows=${textRows.length}, ocrWords=${ocrWords.length}, ocrCandidates=${ocrCands.length}`);
      if (ocrCands.length > 0) {
        console.log(`  OCR candidates on page ${pageNum}:`, ocrCands.map(c => `${c.indexNumber} (${c.rawIndex}) [grade=${c.textGradeOrStatus}]`));
      }

      const reconciled = reconcilePage(textRows, ocrWords, textRows.length === 0, 2.0);
      console.log(`  Reconciled rows for page ${pageNum}: ${reconciled.rows.length}`);

      for (const r of reconciled.rows) {
        if (!r.indexNumber) continue;
        const norm = normaliseIndexNumber(r.indexNumber);
        if (!norm) continue;

        if (seenIndices.has(norm)) {
          console.log(`  Duplicate index on page ${pageNum}: ${norm}`);
          continue;
        }
        seenIndices.set(norm, r);
        allRows.push(r);
      }
    }

    await worker.terminate();

    console.log('\n=== FINAL FULL PIPELINE RESULTS ===');
    console.log('Total extracted unique students:', allRows.length);
    const nonICT = allRows.filter(r => !r.indexNumber.startsWith('ICT/23/'));
    console.log('Non ICT/23 students:', nonICT.length);
    if (nonICT.length > 0) {
      console.log('Non ICT/23 students details:', nonICT);
    }

    expect(allRows).toHaveLength(153);
    expect(allRows[0].indexNumber).toBe('ICT/23/801');
    expect(allRows[allRows.length - 1].indexNumber).toBe('ICT/23/953');
    expect(nonICT).toHaveLength(0);
  }, 120000);
});
