import type { AccessibleDocument, PageContentKind, PdfFileInfo } from '../pdf/document-model';
import { countHeadings } from '../pdf/document-model';
import { dropRepeatedTitle } from '../pdf/repeated-title';

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
 * The headings a reader can navigate in a reading, counted before it is
 * prepared: a first heading that repeats the title is not shown, so it is not
 * counted. The title is the one `decorate` will give the document.
 */
export function shownHeadingCount(raw: AccessibleDocument, info: PdfFileInfo): number {
  return countHeadings(dropRepeatedTitle(raw, info.title ?? raw.metadata.title));
}
