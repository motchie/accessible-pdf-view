import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * Turns individual PDF pages into images for OCR.
 *
 * Deliberately page-at-a-time. Handing a whole PDF to an OCR provider would
 * mean sending pages that already have perfectly good text, which costs money
 * on a hosted provider, wastes time on a local one, and — for a hosted provider
 * — transmits more of the user's document than the job requires. Mixed
 * documents only ever send the pages that actually need OCR.
 *
 * One page, and no batch helper to go with it. There was a `renderPagesToImages`
 * that rendered a list and returned the lot; its only caller now interleaves
 * rendering with recognition (`run-ocr.ts`), because holding every page image
 * of a long scan in memory to deliver them all at the end was the wait and the
 * memory it cost. Rendering is memory-hungry — a scanned A4 page at 300 DPI is
 * ~25 MB of pixel data before encoding — so the helper is not coming back.
 */

export interface PageImageOptions {
  /**
   * Target rendering resolution in DPI. 300 is the usual floor for reliable
   * OCR of body text; below ~200 accuracy falls off sharply.
   */
  dpi?: number;
  /**
   * Cap on the longer edge, in pixels. Set by whoever consumes the image: a
   * model that resizes its input to a fixed square gains nothing from more,
   * and pays for every pixel in render time, encode time and memory.
   */
  maxEdge?: number;
  /** Encoded image type. PNG keeps text edges crisp; JPEG is smaller. */
  mimeType?: 'image/png' | 'image/jpeg';
  quality?: number;
  signal?: AbortSignal;
}

export interface PageImage {
  pageNumber: number;
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
}

/** PDF user-space units are 1/72 inch, so DPI maps straight to a scale. */
const PDF_UNITS_PER_INCH = 72;

/**
 * The scale to render a page at: the requested DPI, reduced if that would
 * exceed the consumer's pixel cap.
 *
 * Separated from the rendering so it can be checked without a PDF — the whole
 * point of it is a number, and getting that number wrong is silent.
 */
export function pageRenderScale(
  widthPt: number,
  heightPt: number,
  options: { dpi?: number; maxEdge?: number } = {},
): number {
  const scale = (options.dpi ?? 300) / PDF_UNITS_PER_INCH;
  const longestPt = Math.max(widthPt, heightPt);
  if (!options.maxEdge || longestPt <= 0) return scale;
  return Math.min(scale, options.maxEdge / longestPt);
}

export async function renderPageToImage(
  document: PDFDocumentProxy,
  pageNumber: number,
  options: PageImageOptions = {},
): Promise<PageImage> {
  const dpi = options.dpi ?? 300;
  const mimeType = options.mimeType ?? 'image/png';

  const page = await document.getPage(pageNumber);
  try {
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: pageRenderScale(unscaled.width, unscaled.height, {
        dpi,
        ...(options.maxEdge ? { maxEdge: options.maxEdge } : {}),
      }),
    });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));

    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context) throw new Error('2D canvas context is unavailable.');

    // Scanned pages are usually white-on-white with no background operator;
    // painting white first avoids handing the OCR engine a transparent image.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    const task = page.render({
      canvas: canvas as HTMLCanvasElement,
      canvasContext: context as CanvasRenderingContext2D,
      viewport,
    });
    options.signal?.addEventListener('abort', () => task.cancel(), { once: true });
    await task.promise;

    const blob = await canvasToBlob(canvas, mimeType, options.quality);
    return { pageNumber, blob, width, height, mimeType };
  } finally {
    page.cleanup();
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: mimeType, quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas encoding failed.'))),
      mimeType,
      quality,
    );
  });
}
