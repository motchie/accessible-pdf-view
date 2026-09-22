import { browser } from 'wxt/browser';
import * as pdfjs from 'pdfjs-dist';
import { VerbosityLevel } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

/**
 * PDF.js integration.
 *
 * Two jobs in the MVP:
 *   1. Render original pages for the Original view, which is the only way a
 *      sighted user can check a scanned document at all.
 *   2. Produce per-page images for OCR.
 *
 * Future jobs (structure tree, figure extraction) will attach to the same
 * `PDFDocumentProxy` this module hands out.
 *
 * Every asset PDF.js needs is served from the extension's own origin — see
 * scripts/copy-assets.mjs. Nothing is fetched from a CDN, both because the MV3
 * CSP forbids it and because opening a PDF must produce no network traffic.
 */

/**
 * Resolves a packaged asset.
 *
 * WXT types `runtime.getURL` against the exact list of files in `public/`, so
 * the directory prefixes PDF.js expects (`cmaps/`, `standard_fonts/`) are not
 * assignable. Widening here is the narrow, deliberate exception.
 */
const getPackagedUrl = browser.runtime.getURL as unknown as (path: string) => string;

function assetUrl(path: string): string {
  return getPackagedUrl(path);
}

let workerConfigured = false;

function configureWorker(): void {
  if (workerConfigured) return;
  // `workerSrc` (rather than bundling the worker through Vite) keeps PDF.js's
  // 1.3 MB worker out of the extension's module graph and lets the browser load
  // it straight from the extension origin, which `script-src 'self'` allows.
  pdfjs.GlobalWorkerOptions.workerSrc = assetUrl('/pdfjs/pdf.worker.min.mjs');
  workerConfigured = true;
}

export interface LoadedPdf {
  document: PDFDocumentProxy;
  pageCount: number;
  destroy(): Promise<void>;
}

export async function loadPdfDocument(bytes: ArrayBuffer): Promise<LoadedPdf> {
  configureWorker();

  const task = pdfjs.getDocument({
    // PDF.js takes ownership of the buffer it is given, so callers pass a copy.
    data: new Uint8Array(bytes),
    // Required for Japanese and other CJK documents: without the CMaps, text
    // in those encodings renders as blanks or tofu.
    cMapUrl: assetUrl('/pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('/pdfjs/standard_fonts/'),
    // JBIG2 / JPEG2000 decoders, which scanned documents lean on heavily.
    wasmUrl: assetUrl('/pdfjs/wasm/'),
    iccUrl: assetUrl('/pdfjs/iccs/'),
    // Real-world PDFs carry malformed embedded fonts, and PDF.js reports each
    // one ("TT: undefined function: 5"). They are defects in the file, not in
    // this extension, and nothing the reader can act on — but at the default
    // level they land in Chrome's extension error page on every document,
    // where they read as though the extension were broken. Errors still
    // surface; only the noise is dropped, and development keeps the warnings.
    verbosity: import.meta.env.DEV ? VerbosityLevel.WARNINGS : VerbosityLevel.ERRORS,
  });

  const document = await task.promise;

  return {
    document,
    pageCount: document.numPages,
    // The loading task, not the proxy, owns teardown in PDF.js v6.
    destroy: () => task.destroy(),
  };
}

export interface RenderPageOptions {
  /** CSS pixels of width to target. The viewport scale is derived from it so
   * pages stay sharp when the user zooms the browser. */
  targetWidth: number;
  /** Multiplies the backing-store resolution. Defaults to the display's DPR. */
  devicePixelRatio?: number;
  signal?: AbortSignal;
}

export interface RenderedPage {
  pageNumber: number;
  /** CSS size the canvas should occupy. */
  cssWidth: number;
  cssHeight: number;
}

/**
 * Renders a page onto a canvas the caller owns.
 *
 * The caller owns the canvas because the Reader needs it in the React tree with
 * its own accessibility annotations; this module refuses to invent DOM.
 */
export async function renderPageToCanvas(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  options: RenderPageOptions,
): Promise<RenderedPage> {
  const page = await document.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = options.targetWidth / base.width;
    const viewport = page.getViewport({ scale });
    const dpr = options.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;

    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    canvas.style.width = `${Math.round(viewport.width)}px`;
    canvas.style.height = `${Math.round(viewport.height)}px`;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas context is unavailable.');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const task = page.render({ canvas, canvasContext: context, viewport });
    options.signal?.addEventListener('abort', () => task.cancel(), { once: true });
    await task.promise;

    return {
      pageNumber,
      cssWidth: Math.round(viewport.width),
      cssHeight: Math.round(viewport.height),
    };
  } finally {
    page.cleanup();
  }
}

export async function getPageSize(
  document: PDFDocumentProxy,
  pageNumber: number,
): Promise<{ width: number; height: number }> {
  const page: PDFPageProxy = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}
