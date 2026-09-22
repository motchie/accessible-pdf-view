import { OPS } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import type { PageContentKind } from '../document-model';

/**
 * What a page that produced no text actually contains.
 *
 * The Reader used to tell the user that the page was stored as an image for
 * every such page. On a real document that turned out to be wrong often enough
 * to be a problem: a presentation deck exported with its text converted to
 * outlines has *no images at all* — every glyph is a vector path. Telling
 * someone the page is an image, while the figure detector finds no image on it,
 * is a contradiction they cannot check and have no way to resolve.
 *
 * So the page is asked what is on it, and the message follows the answer:
 *
 *   `image`   Raster images are painted. A scan, or a picture-only page. OCR is
 *             the thing that would help.
 *   `vector`  Only paths. Usually text converted to outlines, or a diagram
 *             drawn as line art. OCR still helps — the page renders to pixels
 *             like any other — but calling it "an image" is false.
 *   `blank`   Neither. The page really is empty.
 *
 * Deliberately coarse. This drives one sentence of wording, so a
 * mostly-right cheap classification beats an exact expensive one; the counting
 * stops as soon as the answer cannot change.
 */
export type { PageContentKind };

/**
 * A handful of paths is not a diagram.
 *
 * Nearly every page carries a background rectangle, a rule, or a footer line.
 * Calling those "shapes" would replace one misleading message with another, so a
 * page has to be doing more drawing than that before it counts as vector
 * content. Text converted to outlines runs to hundreds of paths per page; the
 * separator pages in the document that prompted this run to about forty.
 */
const MIN_VECTOR_PATHS = 8;

export async function classifyPageContent(page: PDFPageProxy): Promise<PageContentKind> {
  const operators = await page.getOperatorList();

  let paths = 0;
  for (const fn of operators.fnArray) {
    // Any raster paint settles it — nothing later can make the page more
    // image-like than it already is.
    if (
      fn === OPS.paintImageXObject ||
      fn === OPS.paintImageXObjectRepeat ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageMaskXObject
    ) {
      return 'image';
    }
    if (fn === OPS.constructPath) paths++;
  }

  return paths >= MIN_VECTOR_PATHS ? 'vector' : 'blank';
}

/**
 * Classifies exactly the pages asked for.
 *
 * Only pages that produced no text are ever passed in: building an operator
 * list is real work, and a page whose text was extracted needs no explanation
 * at all.
 */
export async function classifyPages(
  pdf: { getPage(pageNumber: number): Promise<PDFPageProxy> },
  pageNumbers: readonly number[],
  options: { signal?: AbortSignal } = {},
): Promise<Map<number, PageContentKind>> {
  const kinds = new Map<number, PageContentKind>();

  for (const pageNumber of pageNumbers) {
    if (options.signal?.aborted) break;
    const page = await pdf.getPage(pageNumber);
    try {
      kinds.set(pageNumber, await classifyPageContent(page));
    } finally {
      page.cleanup();
    }
  }

  return kinds;
}
