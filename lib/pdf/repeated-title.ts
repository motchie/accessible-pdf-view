import type { AccessibleDocument } from './document-model';
import { inlineToPlainText } from './document-model';
import { normalizeCjkSpacing } from './inspector/markdown-to-document';

/**
 * The document without a first heading that only repeats its title.
 *
 * The Reader shows the title as the page's `<h1>` and the Markdown export as
 * its `#`, so a body heading saying the same thing would be read twice — and
 * would be counted as a heading the reader can navigate to when it is not
 * shown. Everything that presents or counts a reading's headings goes through
 * this one function, so the three cannot disagree about whether it is there.
 *
 * `title` defaults to the document's own; pass the title that will actually be
 * shown when it comes from elsewhere (the PDF's `/Title`, before `decorate`
 * has folded it in).
 */
export function dropRepeatedTitle(
  document: AccessibleDocument,
  title: string | undefined = document.metadata.title,
): AccessibleDocument {
  const wanted = title === undefined ? '' : comparableTitle(title);
  if (!wanted) return document;

  const firstWithContent = document.pages.findIndex((page) => page.nodes.length > 0);
  if (firstWithContent === -1) return document;

  const [first] = document.pages[firstWithContent]!.nodes;
  if (first?.type !== 'heading' || comparableTitle(inlineToPlainText(first.content)) !== wanted) {
    return document;
  }

  return {
    ...document,
    pages: document.pages.map((page, index) =>
      index === firstWithContent ? { ...page, nodes: page.nodes.slice(1) } : page,
    ),
  };
}

/**
 * The two sides of the title comparison come through different paths: the
 * heading's text has had the spaces between Japanese characters removed as
 * extraction artefacts, and the `/Title` metadata has not. Word's
 * 「検証用文書 その1」 arrives as a heading reading 「検証用文書その1」, and an
 * exact comparison let the title be read twice. Both sides get the same
 * normalisation, so the comparison is between what each one says.
 */
function comparableTitle(text: string): string {
  return normalizeCjkSpacing(text.replace(/\s+/g, ' ').trim());
}
