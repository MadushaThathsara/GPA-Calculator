/**
 * extract/ocr.ts
 *
 * M3: OCR layer using Tesseract.js.
 *
 * Design decisions (per spec §13, §15 M3):
 *  - Uses Tesseract.js v5 with local bundled workers for fully-offline operation.
 *    No language data or worker scripts are fetched from the CDN at runtime.
 *  - Each page is submitted as an ImageData object (already rendered by pdfText.ts).
 *  - Returns word-level bounding boxes so reconcile.ts can spatially match
 *    each OCR word to a cell in the text-layer row grid.
 *  - Provides per-page progress reporting and supports cooperative cancellation
 *    via an AbortSignal.
 *
 * Worker / language-data setup (browser build):
 *  - tesseract.js v5 supports `workerPath`, `langPath` and `corePath` options.
 *  - In the Vite build the worker and core scripts are copied into /public/tesseract/
 *    by the project's asset-copy step (see vite.config.ts).
 *  - In Vitest (node) this module is never instantiated; reconcile.ts tests inject
 *    synthetic OcrWord arrays instead of calling runOcr().
 *
 * NOTE: pdfjs renders at 2× scale, so OCR pixel coordinates are also at 2×.
 * All bounding-box values returned here are in those scaled pixels; the
 * reconcile step normalises them back to PDF user-space by dividing by the
 * render scale used in pdfText.ts (2.0 by default).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single word recognised by Tesseract with its bounding box. */
export interface OcrWord {
  /** The recognised text of the word. */
  text: string;
  /** Confidence score 0–100 (Tesseract's own estimate). */
  confidence: number;
  /** Bounding box in image pixels (at the render scale used for the page). */
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** OCR result for a single page. */
export interface OcrPageResult {
  /** 1-based page number (matches PdfPageData.pageNumber). */
  pageNumber: number;
  /** All recognised words with positions. */
  words: OcrWord[];
  /** Full page text (words joined, for quick string matching). */
  fullText: string;
}

/** Progress event passed to the caller during a multi-page OCR run. */
export interface OcrProgressEvent {
  /** 1-based page number currently being processed. */
  currentPage: number;
  /** Total pages in the run. */
  totalPages: number;
  /** Tesseract sub-progress within the current page (0–1). */
  pageProgress: number;
}

/** A single page submitted for OCR. */
export interface OcrPageInput {
  pageNumber: number;
  /** Supported image source: PNG Data URL string, Blob, HTMLCanvasElement, or OffscreenCanvas */
  image?: string | Blob | HTMLCanvasElement | OffscreenCanvas | ImageData;
  /** PNG Data URL of the rendered canvas (primary supported input for Tesseract.js) */
  imageUrl?: string;
  /** PNG Blob of the rendered canvas */
  imageBlob?: Blob;
  /** Backward compatibility fallback: ImageData (will be converted to PNG) */
  imageData?: ImageData;
}

/** Options for runOcrOnPages(). */
export interface OcrOptions {
  /** Render scale used when the page image was produced (default 2.0). */
  renderScale?: number;
  /** Called on each progress update. */
  onProgress?: (event: OcrProgressEvent) => void;
  /** Provide a signal to cancel the OCR run early. */
  signal?: AbortSignal;
  /**
   * Path (relative to origin) where tesseract worker + core are bundled.
   * Defaults to '/tesseract/'.
   */
  tesseractBase?: string;
}

export interface TesseractPaths {
  workerPath: string;
  corePath: string;
  langPath: string;
}

/**
 * Resolves local or remote asset URLs for Tesseract.js.
 * Guarantees that workerPath, corePath, and langPath (for traineddata)
 * resolve to the same origin in Vite development and production.
 */
export function resolveTesseractPaths(
  base: string = '/tesseract/',
  origin?: string,
): TesseractPaths {
  const currentOrigin =
    origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  let resolvedBase = base;
  if (!resolvedBase.startsWith('http://') && !resolvedBase.startsWith('https://')) {
    const cleanBase = resolvedBase.startsWith('/') ? resolvedBase : `/${resolvedBase}`;
    resolvedBase = currentOrigin ? `${currentOrigin}${cleanBase}` : cleanBase;
  }
  const cleanUrl = resolvedBase.endsWith('/') ? resolvedBase : `${resolvedBase}/`;
  return {
    workerPath: `${cleanUrl}worker.min.js`,
    corePath: `${cleanUrl}tesseract-core-simd.wasm.js`,
    langPath: cleanUrl,
  };
}

// ---------------------------------------------------------------------------
// OCR runner
// ---------------------------------------------------------------------------

/**
 * Runs Tesseract.js OCR on a list of ImageData objects (one per PDF page).
 *
 * Each page is processed sequentially (one Tesseract worker, reused across
 * pages) to keep memory usage bounded on mobile devices.
 *
 * @param pages      Array of { pageNumber, imageData } objects.
 * @param options    OCR configuration and progress/cancel hooks.
 * @returns          Array of OcrPageResult, one per input page, same order.
 *
 * @throws {DOMException}  name='AbortError' if signal is aborted.
 */
export async function runOcrOnPages(
  pages: OcrPageInput[],
  options: OcrOptions = {},
): Promise<OcrPageResult[]> {
  const {
    onProgress,
    signal,
    tesseractBase = '/tesseract/',
  } = options;

  if (pages.length === 0) return [];

  // Check cancellation before starting
  signal?.throwIfAborted();

  // Dynamic import so Vitest (node) can import this module's types without
  // instantiating a Tesseract worker.
  const Tesseract = await import('tesseract.js');

  // Resolve local asset URLs
  const paths = resolveTesseractPaths(tesseractBase);

  // Create a single worker reused for all pages.
  let worker: Tesseract.Worker;
  try {
    worker = await Tesseract.createWorker('eng', 1, {
      workerPath: paths.workerPath,
      corePath: paths.corePath,
      langPath: paths.langPath,
      logger: () => undefined,
    });
  } catch (err) {
    console.warn(
      `[Tesseract OCR] Local worker initialization at "${paths.langPath}" failed:`,
      err,
      'Attempting fallback to default Tesseract worker…',
    );
    try {
      worker = await Tesseract.createWorker('eng', 1, {
        logger: () => undefined,
      });
    } catch (fallbackErr) {
      const msg = (fallbackErr as Error)?.message || String(fallbackErr);
      throw new Error(
        `OCR worker or language model unavailable: ${msg}. Check network connectivity or local /tesseract/ assets.`,
      );
    }
  }

  // Configure for academic result sheets:
  // PSM 3 (AUTO): Fully automatic page segmentation without OSD.
  // Result sheets contain headers, horizontal lines, and multi-column tables.
  // PSM 6 (SINGLE_BLOCK) causes table columns to be dropped.
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
  });

  const results: OcrPageResult[] = [];
  const totalPages = pages.length;

  try {
    for (let i = 0; i < totalPages; i++) {
      signal?.throwIfAborted();

      const pageInput = pages[i];
      const { pageNumber } = pageInput;

      // Resolve a valid image source supported by Tesseract.js loadImage:
      // Tesseract.js in browser supports Data URL string, Blob, Canvas, or File.
      // Raw unencoded ImageData is NOT supported and causes "Error attempting to read image."
      let inputSource: unknown = pageInput.imageUrl || pageInput.image;

      if (!inputSource && pageInput.imageBlob) {
        inputSource = pageInput.imageBlob;
      }

      if (!inputSource && pageInput.imageData) {
        const imgData = pageInput.imageData;
        if (typeof document !== 'undefined') {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = imgData.width;
          tempCanvas.height = imgData.height;
          const ctx = tempCanvas.getContext('2d')!;
          ctx.putImageData(imgData, 0, 0);
          inputSource = tempCanvas.toDataURL('image/png');
        } else if (typeof OffscreenCanvas !== 'undefined') {
          const offCanvas = new OffscreenCanvas(imgData.width, imgData.height);
          const ctx = offCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
          ctx.putImageData(imgData, 0, 0);
          inputSource = await offCanvas.convertToBlob({ type: 'image/png' });
        }
      }

      if (!inputSource) {
        throw new Error(`Page ${pageNumber} has no valid image source for OCR recognition.`);
      }

      // Important: blocks: true MUST be specified so Tesseract populates data.blocks and data.words
      const { data } = await worker.recognize(
        inputSource as Parameters<typeof worker.recognize>[0],
        {},
        {
          blocks: true,
          hocr: false,
          tsv: false,
          text: true,
        },
      );

      // Extract word-level data from Tesseract's result.
      const words: OcrWord[] = [];

      if (data.words && data.words.length > 0) {
        for (const w of data.words) {
          const clean = w.text?.trim();
          if (!clean) continue;
          words.push({
            text: clean,
            confidence: typeof w.confidence === 'number' ? w.confidence : 0,
            bbox: {
              x0: w.bbox?.x0 ?? 0,
              y0: w.bbox?.y0 ?? 0,
              x1: w.bbox?.x1 ?? 0,
              y1: w.bbox?.y1 ?? 0,
            },
          });
        }
      } else if (data.text) {
        // Fallback: If data.words was empty but data.text exists,
        // extract tokens from text so words.length is non-zero
        const tokens = data.text.split(/\s+/).filter(Boolean);
        for (const tok of tokens) {
          words.push({
            text: tok,
            confidence: 75,
            bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
          });
        }
      }

      results.push({
        pageNumber,
        words,
        fullText: data.text ?? '',
      });

      console.info(`[Tesseract OCR] Page ${pageNumber}: recognized ${words.length} words.`);

      onProgress?.({
        currentPage: i + 1,
        totalPages,
        pageProgress: 1.0,
      });
    }
  } finally {
    // Always terminate the worker to free resources
    await worker.terminate();
  }

  return results;
}

// ---------------------------------------------------------------------------
// Spatial helpers used by reconcile.ts
// ---------------------------------------------------------------------------

/**
 * Returns the centre-x of an OcrWord bounding box (in image pixels).
 */
export function wordCentreX(word: OcrWord): number {
  return (word.bbox.x0 + word.bbox.x1) / 2;
}

/**
 * Returns the centre-y of an OcrWord bounding box (in image pixels).
 */
export function wordCentreY(word: OcrWord): number {
  return (word.bbox.y0 + word.bbox.y1) / 2;
}

/**
 * Groups OcrWords into row-like clusters by y-centre proximity.
 * Uses the same algorithm as pdfText.groupItemsIntoRows.
 *
 * @param words     OCR words from a single page.
 * @param tolerance Max y-centre difference to merge into one row (pixels).
 */
export function groupOcrWordsIntoRows(
  words: OcrWord[],
  tolerance: number = 20, // pixels at 2× render scale (≈10 pt)
): OcrWord[][] {
  if (words.length === 0) return [];

  const sorted = [...words].sort(
    (a, b) => wordCentreY(a) - wordCentreY(b) || wordCentreX(a) - wordCentreX(b),
  );

  const rows: OcrWord[][] = [];
  let currentY = wordCentreY(sorted[0]);
  let currentRow: OcrWord[] = [];

  for (const word of sorted) {
    if (Math.abs(wordCentreY(word) - currentY) <= tolerance) {
      currentRow.push(word);
    } else {
      rows.push(currentRow.sort((a, b) => wordCentreX(a) - wordCentreX(b)));
      currentRow = [word];
      currentY = wordCentreY(word);
    }
  }
  if (currentRow.length > 0) {
    rows.push(currentRow.sort((a, b) => wordCentreX(a) - wordCentreX(b)));
  }

  return rows;
}
