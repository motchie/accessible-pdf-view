import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { AccessibleDocument, BoundingBox } from '../document-model';
import { collectFigures, mapFigures } from '../document-model';

/**
 * Turning a region of a page into pixels.
 *
 * Two callers with different needs, which is why the resolution is a parameter
 * rather than a constant: the Reader renders a figure to look at, and the
 * describer renders one for a model to read.
 */

/**
 * Renders one region of a page.
 *
 * Rather than rasterising the whole page and cropping — which for a 300 DPI A4
 * page means holding ~25 MB of pixels to keep a thumbnail — the viewport is
 * offset so PDF.js draws only the requested region onto a canvas the size of
 * that region.
 */
export async function renderRegionToBlob(
  page: PDFPageProxy,
  bbox: BoundingBox,
  options: {
    dpi?: number;
    /**
     * Cap on the longer edge, in pixels.
     *
     * A full-width photograph at 200 DPI is well over 1200px, and an on-device
     * model gains nothing from that while paying for every pixel in latency.
     * Downscaling keeps a figure describable in seconds rather than minutes.
     */
    maxEdge?: number;
    mimeType?: 'image/png' | 'image/jpeg';
    signal?: AbortSignal;
  } = {},
): Promise<Blob> {
  const requested = (options.dpi ?? 200) / 72;
  const longestEdgePt = Math.max(bbox.width, bbox.height);
  const scale =
    options.maxEdge && longestEdgePt * requested > options.maxEdge
      ? options.maxEdge / longestEdgePt
      : requested;
  const mimeType = options.mimeType ?? 'image/png';

  // The region is in PDF user space (y up); the canvas is in viewport space
  // (y down). Converting both corners and normalising handles the flip.
  const base = page.getViewport({ scale });
  const [x1, y1] = base.convertToViewportPoint(bbox.x, bbox.y);
  const [x2, y2] = base.convertToViewportPoint(bbox.x + bbox.width, bbox.y + bbox.height);

  const left = Math.min(x1!, x2!);
  const top = Math.min(y1!, y2!);
  const width = Math.max(1, Math.round(Math.abs(x2! - x1!)));
  const height = Math.max(1, Math.round(Math.abs(y2! - y1!)));

  const viewport = page.getViewport({ scale, offsetX: -left, offsetY: -top });

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!context) throw new Error('2D canvas context is unavailable.');

  // Images with transparency would otherwise arrive as black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);

  const task = page.render({
    canvas: canvas as HTMLCanvasElement,
    canvasContext: context as CanvasRenderingContext2D,
    viewport,
  });
  options.signal?.addEventListener('abort', () => task.cancel(), { once: true });
  await task.promise;

  return canvasToBlob(canvas, mimeType);
}

/**
 * Renders every located figure and gives it a blob URL, so the Reader can show
 * the actual picture.
 *
 * This is what turns the placeholder into a real `<figure><img></figure>`. It
 * also matters for the generated-description feature: a sighted reviewer can
 * see the image next to the description and judge whether it is any good —
 * which the person relying on the description cannot do.
 *
 * The returned `revoke` must be called when the document is discarded; blob
 * URLs are held by the document until it is.
 */
export async function materializeFigureImages(
  document: AccessibleDocument,
  pdf: PDFDocumentProxy,
  options: { dpi?: number; signal?: AbortSignal } = {},
): Promise<{ document: AccessibleDocument; revoke: () => void }> {
  const urls: string[] = [];

  const pages = await Promise.all(
    document.pages.map(async (page) => {
      if (options.signal?.aborted) return page;

      // Render first, then swap the sources in: `mapFigures` is synchronous,
      // so the images have to exist before the tree is rebuilt.
      const rendered = new Map<number, string>();
      const figures = collectFigures(page.nodes);
      if (figures.length === 0) return page;

      for (const [index, { figure }] of figures.entries()) {
        if (!figure.region || figure.source) continue;
        try {
          const pdfPage = await pdf.getPage(figure.region.pageNumber);
          const blob = await renderRegionToBlob(pdfPage, figure.region.bbox, {
            // Display resolution, not OCR resolution — this is for looking at.
            dpi: options.dpi ?? 144,
            ...(options.signal ? { signal: options.signal } : {}),
          });
          pdfPage.cleanup();

          const url = URL.createObjectURL(blob);
          urls.push(url);
          rendered.set(index, url);
        } catch {
          // Keep the figure; it falls back to the placeholder.
        }
      }
      if (rendered.size === 0) return page;

      const nodes = mapFigures(page.nodes, (figure, index) => {
        const url = rendered.get(index);
        // `region` is left in place: replacing it would strand the describer,
        // which needs to go back to the pixels after this point.
        return url ? { ...figure, source: { kind: 'url', url } } : figure;
      });

      return { ...page, nodes };
    }),
  );

  return {
    document: { ...document, pages },
    revoke: () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.length = 0;
    },
  };
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mimeType: string,
): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: mimeType });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas encoding failed.'))),
      mimeType,
    );
  });
}
