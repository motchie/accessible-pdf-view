import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  AccessibleDocument,
  DocumentOrigin,
  PageContentKind,
  PdfFileInfo,
} from '../pdf/document-model';
import { countHeadings, documentToPlainText } from '../pdf/document-model';
import { combineReadings } from '../pdf/combined-reading';
import { promoteMergedHeadings } from '../pdf/inspector/heading-promotion';
import { attachFigureRegions } from '../pdf/pdfjs/figure-regions';
import { detectLanguage, detectScriptLanguage } from '../pdf/pdfjs/language';
import { readPdfDocumentInfo } from '../pdf/pdfjs/metadata';
import { materializeFigureImages } from '../pdf/pdfjs/region-raster';
import { recoverEmptyPages } from '../pdf/pdfjs/recover-pages';
import { coversPageText, extractTaggedDocument, isUsable } from '../pdf/pdfjs/tagged-adapter';
import { dropRepeatedTitle } from '../pdf/repeated-title';
import type { StructureSource } from './settings';
import { initialStructureSource } from './structure-source';

/**
 * The steps of reading a PDF, without the React around them.
 *
 * `usePdfAnalysis` runs these in order, checking between them whether the
 * reader has moved on, and keeps their results in state. The outline tests run
 * the same functions under Node. Keeping the steps here, rather than in the
 * hook, is what makes those tests check the Reader rather than a copy of it:
 * a change to how a reading is built, prepared or counted is made once.
 */

/** The readings a PDF offers, as their producers left them. */
export interface Readings {
  info: PdfFileInfo;
  /** In offered order: the picker lists them as they were added, and a
   * preference the document cannot honour falls to the first. */
  raw: Map<DocumentOrigin, AccessibleDocument>;
}

/**
 * Builds every reading the document offers from pdf-inspector's document and
 * the PDF.js document.
 *
 * Throws the abort reason once `signal` is aborted. The steps it calls stop
 * early when aborted and hand back what they had, which is a partial reading
 * that looks like a whole one; this, and `prepareReading`, never return that.
 */
export async function buildReadings(
  inspectorDocument: AccessibleDocument,
  pdf: PDFDocumentProxy,
  options: { sourceUrl: string | null; signal?: AbortSignal },
): Promise<Readings> {
  const { sourceUrl, signal } = options;
  signal?.throwIfAborted();

  // The headings pdf-inspector merged into the paragraph below them, split
  // back apart at the line break PDF.js still has. Done here, before the
  // documents are counted or shown, so the heading count the Reader offers for
  // this reading is the one it will actually navigate.
  const inferred = await promoteMergedHeadings(inspectorDocument, pdf, { signal });
  signal?.throwIfAborted();
  const info = await readPdfDocumentInfo(pdf);
  signal?.throwIfAborted();

  const raw = new Map<DocumentOrigin, AccessibleDocument>();

  // Either is enough: a tree without the `/Marked` declaration is still the
  // author's structure, and `isUsable` below rejects an empty one. Undeclared,
  // it must also carry most of the page text: without the declaration nothing
  // says the tree is the whole document.
  if (info.isTagged || info.hasStructureTree) {
    const tagged = await extractTaggedDocument(pdf, { sourceUrl, info, signal });
    signal?.throwIfAborted();
    if (isUsable(tagged) && (info.isTagged || coversPageText(tagged!))) {
      // The author's structure, plus the headings the inferred reading can show
      // it lacks. Null for most documents: any heading tag of the author's own,
      // or nothing verifiable to add, and there is no third reading to offer.
      const combined = combineReadings(
        tagged!.document,
        inferred,
        info.title ?? tagged!.document.metadata.title,
      );
      if (combined) raw.set('combined', combined);
      raw.set('tagged-pdf', tagged!.document);
    }
  }
  raw.set('pdf-inspector', inferred);

  return { info, raw };
}

/** The reading to open with: the reader's setting, where there is a choice. */
export function chooseReading(
  available: readonly DocumentOrigin[],
  preferred: StructureSource,
): DocumentOrigin {
  return initialStructureSource(available, preferred) ?? 'pdf-inspector';
}

/** Renders a document's located figures to images it can display. */
export type FigureRasterizer = (
  document: AccessibleDocument,
  pdf: PDFDocumentProxy,
  options: { signal?: AbortSignal },
) => Promise<{ document: AccessibleDocument; revoke: () => void }>;

/**
 * Prepares one reading for display.
 *
 * Neither producer positions its figures, so this is where they are found on
 * the page and given an image of it. `rasterize` is the canvas step; the tests
 * substitute one that needs no canvas. Throws once `signal` is aborted, as
 * `buildReadings` does, freeing any images it had already made.
 */
export async function prepareReading(
  raw: AccessibleDocument,
  pdf: PDFDocumentProxy,
  options: { signal?: AbortSignal; rasterize?: FigureRasterizer } = {},
): Promise<{ document: AccessibleDocument; revoke: () => void }> {
  const { signal, rasterize = materializeFigureImages } = options;
  signal?.throwIfAborted();
  // Before anything else: a page this producer dropped is not an empty page,
  // and must not reach the reader described as one.
  const complete = await recoverEmptyPages(raw, pdf, { signal });
  signal?.throwIfAborted();
  const positioned = await attachFigureRegions(complete, pdf, { signal });
  signal?.throwIfAborted();
  const rasterized = await rasterize(positioned, pdf, { signal });
  if (signal?.aborted) {
    rasterized.revoke();
    signal.throwIfAborted();
  }
  return rasterized;
}

/**
 * The document's language. `/Lang` wins; detection only fills the gap. Without
 * a language the screen reader picks its own, which mispronounces the document.
 */
export async function documentLanguage(
  document: AccessibleDocument,
  info: PdfFileInfo,
  options: { signal?: AbortSignal } = {},
): Promise<string | undefined> {
  const sample = documentToPlainText(document).slice(0, 4000);
  return (
    info.language ??
    document.metadata.language ??
    (await detectLanguage(sample, { signal: options.signal })) ??
    // Chrome's detector needs its own model download and reports
    // `downloadable` until the user has one, so on many machines the line
    // above returns null for a document that plainly is not English.
    detectScriptLanguage(sample) ??
    undefined
  );
}

/**
 * The text-less pages whose cause is still to be found: the ones the producer
 * did not explain. pdf-inspector reports a cause per page, and walking a
 * scanned page's content stream for an answer already in the result is seconds
 * on a long deck.
 */
export function pagesNeedingExplanation(document: AccessibleDocument): number[] {
  return document.pages
    .filter((page) => page.status === 'requires-ocr' && !page.ocrCauses?.length)
    .map((page) => page.pageNumber);
}


/** What belongs to the PDF rather than to any one reading of it. */
export interface DocumentFacts {
  info: PdfFileInfo;
  language: string | undefined;
  kinds: Map<number, PageContentKind>;
}

/**
 * Folds in what belongs to the PDF rather than to a producer: its own title and
 * language, and what its text-less pages actually draw.
 */
export function decorate(document: AccessibleDocument, facts: DocumentFacts): AccessibleDocument {
  return {
    ...document,
    metadata: {
      ...document.metadata,
      // The document's own title and language beat anything inferred.
      title: facts.info.title ?? document.metadata.title,
      ...(facts.language ? { language: facts.language } : {}),
      info: facts.info,
    },
    pages:
      facts.kinds.size === 0
        ? document.pages
        : document.pages.map((page) => {
            const kind = facts.kinds.get(page.pageNumber);
            return kind ? { ...page, contentKind: kind } : page;
          }),
  };
}

/**
 * The headings a reader can navigate in a reading: a first heading that repeats
 * the title is not shown, so it is not counted. The title is the one `decorate`
 * gives the document. Count the document as it is shown once it has been
 * prepared — recovered pages and OCR change which heading comes first.
 */
export function shownHeadingCount(document: AccessibleDocument, info: PdfFileInfo): number {
  return countHeadings(dropRepeatedTitle(document, info.title ?? document.metadata.title));
}

/**
 * Headings per reading, as the picker offers them: a reading that has been
 * prepared is counted as prepared, because recovering empty pages can change
 * which heading comes first, and so whether it is the title; the others are
 * counted as their producers left them.
 */
export function readingHeadingCounts(
  raw: ReadonlyMap<DocumentOrigin, AccessibleDocument>,
  prepared: Partial<Record<DocumentOrigin, AccessibleDocument>>,
  info: PdfFileInfo,
): Partial<Record<DocumentOrigin, number>> {
  return Object.fromEntries(
    [...raw].map(([origin, document]) => [
      origin,
      shownHeadingCount(prepared[origin] ?? document, info),
    ]),
  );
}
