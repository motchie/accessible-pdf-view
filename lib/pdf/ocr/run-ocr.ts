import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument } from '../document-model';
import { PdfError } from '../errors';
import { renderPageToImage } from '../pdfjs/page-image';
import { adaptOcrResult } from './adapter';
import type { OcrOptions, OcrPageResult, OcrProvider } from './provider';
import { requiresConsent } from './registry';

/**
 * Runs OCR over exactly the pages that need it — rasterise a page, read it,
 * hand it over, then start the next one.
 *
 * The full path, as the original brief laid it out in §15:
 *   PDF -> PDF.js -> page -> image -> OcrProvider -> OcrAdapter -> Document Model
 *
 * Only `pageNumbers` are rasterised and sent. On a document where page 3 of 20
 * is a scan, one page is processed — not twenty.
 *
 * ## Why the loop is here rather than one call with every image
 *
 * This used to rasterise every requested page up front, hand the whole array
 * to the provider, and return a single result at the end. Two things were
 * wrong with that on a long scan, and both were felt as "the button does
 * nothing":
 *
 *   - **Nothing appeared until the last page finished.** A page is seconds of
 *     on-device model work, so a 29-page deck is minutes of unchanged screen,
 *     and a failure part-way through threw away every page already read.
 *     `onPageResolved` fires after each page instead, so the document fills in
 *     as it is read and work already done survives whatever happens next. The
 *     figure describer learned this first; `onFigureResolved` in
 *     `run-describe.ts` exists for the same reason.
 *   - **Every page image was alive at once.** A page rendered at the default
 *     300 DPI is megabytes of encoded PNG, and the old shape held one per
 *     requested page for the whole run. Now at most one exists at a time.
 *
 * `OcrInput` still takes a list of pages rather than one, because a hosted
 * engine that genuinely batches is a reason to group them again. But grouping
 * means the group lands at once, which is the wait this removed — so a
 * provider that wants it should declare it on the interface rather than get it
 * by default.
 */
export interface RunOcrParams {
  provider: OcrProvider;
  pdf: PDFDocumentProxy;
  /** 1-indexed pages needing OCR. */
  pageNumbers: number[];
  sourceUrl?: string | null;
  pageCount?: number;
  dpi?: number;
  /** Must be true before a provider that transmits data externally will run. */
  consentGiven?: boolean;
  /**
   * Called after each page, with every page read so far.
   *
   * Cumulative rather than one page at a time: `mergeOcrPages` already folds a
   * whole OCR document into the document on screen and leaves a page it has
   * folded in before exactly as it is, so the caller merges a partial run the
   * same way it merges a finished one. A per-page callback would make the
   * caller accumulate pages itself — a second place that knows how to assemble
   * an OCR document, and one more chance for the two to disagree.
   */
  onPageResolved?: (document: AccessibleDocument) => void;
  ocrOptions?: OcrOptions;
}

export async function runOcrForPages(params: RunOcrParams): Promise<AccessibleDocument> {
  const { provider, pdf, pageNumbers } = params;
  const signal = params.ocrOptions?.signal;

  if (requiresConsent(provider) && !params.consentGiven) {
    throw new PdfError('ocr-failed', 'ocr-consent');
  }

  /** One entry per page the provider actually returned something for — the
   * pages that were attempted, including the ones it could not read. */
  const attempted: OcrPageResult[] = [];
  const assemble = () =>
    adaptOcrResult(
      { providerId: provider.id, pages: attempted },
      { sourceUrl: params.sourceUrl, pageCount: params.pageCount },
    );

  for (const pageNumber of pageNumbers) {
    if (signal?.aborted) break;

    const image = await renderPageToImage(pdf, pageNumber, {
      dpi: params.dpi ?? 300,
      // The provider decides how big an image is worth making.
      ...(provider.preferredImage?.maxEdge ? { maxEdge: provider.preferredImage.maxEdge } : {}),
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) break;

    const result = await provider.analyze(
      {
        pages: [
          {
            pageNumber: image.pageNumber,
            image: image.blob,
            width: image.width,
            height: image.height,
          },
        ],
      },
      params.ocrOptions,
    );

    attempted.push(...result.pages);
    params.onPageResolved?.(assemble());
  }

  return assemble();
}
