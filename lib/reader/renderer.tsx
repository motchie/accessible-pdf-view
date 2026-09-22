import type { JSX, ReactNode } from 'react';
import { useMessages, type Messages } from '../i18n';
import type {
  AccessibleDocument,
  DocumentNode,
  DocumentPage,
  InlineNode,
  TableRow as ModelTableRow,
} from '../pdf/document-model';
import { inlineToPlainText } from '../pdf/document-model';

/**
 * Document Model -> semantic HTML.
 *
 * This is the file the whole project exists for. The output is ordinary HTML:
 * `<h2>`, `<p>`, `<ul>`, `<table>`, `<a>`, `<figure>`. That is what puts real
 * entries in the browser's accessibility tree, which is what makes heading
 * navigation, table navigation, list navigation, link lists and browser find
 * behave exactly as they do on any other web page.
 *
 * Two rules it does not break:
 *   - No `dangerouslySetInnerHTML`. Every node becomes a React element, so no
 *     string from the PDF is ever interpreted as markup.
 *   - Native semantics first. There is no ARIA in here at all, because HTML
 *     already expresses everything this model contains.
 */

export interface DocumentViewProps {
  document: AccessibleDocument;
  /**
   * Levels to add to every heading. The Reader renders the document title as
   * the page's `<h1>`, so content headings start at `<h2>` and the hierarchy
   * stays logical no matter what levels the PDF's own headings claimed.
   */
  headingOffset?: number;
  /** Rendered in place of a page whose text could not be extracted. */
  renderPageNotice?: (page: DocumentPage) => ReactNode;
  /** Show "— page N —" separators between pages. */
  showPageBreaks?: boolean;
}

export function DocumentView({
  document,
  headingOffset = 1,
  renderPageNotice,
  showPageBreaks = true,
}: DocumentViewProps): JSX.Element {
  // A heading in the body that merely repeats the title would be read twice and
  // would sit at the same level as the page's `<h1>`.
  const title = document.metadata.title?.trim();
  const pages = title ? dropLeadingTitleHeading(document.pages, title) : document.pages;

  return (
    <>
      {pages.map((page, pageIndex) => (
        <div className="apv-page" key={page.pageNumber} data-page={page.pageNumber}>
          {showPageBreaks && pageIndex > 0 ? <PageBreak pageNumber={page.pageNumber} /> : null}
          {page.nodes.map((node, index) => (
            <BlockNode key={index} node={node} headingOffset={headingOffset} />
          ))}
          {page.nodes.length === 0 ? renderPageNotice?.(page) : null}
        </div>
      ))}
    </>
  );
}

/**
 * A page boundary. Deliberately not a heading: page numbers are navigation
 * furniture, and putting them in the heading outline would bury the document's
 * real structure under one entry per page.
 */
function PageBreak({ pageNumber }: { pageNumber: number }): JSX.Element {
  const m = useMessages();
  return (
    <p className="apv-page-break">
      <span className="apv-page-break__label">{m.figures.pageLabel(pageNumber)}</span>
    </p>
  );
}

function BlockNode({
  node,
  headingOffset,
}: {
  node: DocumentNode;
  headingOffset: number;
}): JSX.Element | null {
  const m = useMessages();
  switch (node.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, node.level + headingOffset));
      const Heading = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      // A node that came from a producer other than its page's says so on the
      // element. The combined reading's headings are the case: the words are
      // the author's, the claim that they head a section is inferred, and the
      // reading's own name and the document panel say as much for the whole
      // document. It is not repeated aloud on every heading — a reader
      // navigating by `H` would hear the same caveat at every stop — so it
      // sits where a stylesheet or a tester can find it.
      return (
        <Heading {...(node.origin ? { 'data-origin': node.origin } : {})}>
          <Inline nodes={node.content} />
        </Heading>
      );
    }

    case 'paragraph':
      return (
        <p {...(node.origin ? { 'data-origin': node.origin } : {})}>
          <Inline nodes={node.content} />
        </p>
      );

    case 'unknown':
      // Unclassified content is still content; rendering it as a paragraph
      // means nothing the PDF contained is silently dropped.
      return (
        <p>
          <Inline nodes={node.content} />
        </p>
      );

    case 'list': {
      const List = node.ordered ? 'ol' : 'ul';
      return (
        <List {...(node.ordered && node.start ? { start: node.start } : {})}>
          {node.items.map((item, index) => (
            <li key={index}>
              {item.blocks.map((block, blockIndex) => (
                <BlockNode key={blockIndex} node={block} headingOffset={headingOffset} />
              ))}
            </li>
          ))}
        </List>
      );
    }

    case 'table':
      return (
        // A wide table has to be able to scroll sideways without the page
        // doing so. A scrollable box must be reachable by keyboard, and a
        // focusable box needs a role and a name — this is the standard pairing
        // for that, not decoration.
        <div
          className="apv-table-scroll"
          role="region"
          aria-label={node.caption ? m.figures.tableWithCaption(node.caption) : m.figures.table}
          tabIndex={0}
        >
          <table>
            {node.caption ? <caption>{node.caption}</caption> : null}
            {node.header ? (
              <thead>
                <Row row={node.header} defaultHeader scope="col" />
              </thead>
            ) : null}
            <tbody>
              {node.rows.map((row, index) => (
                <Row key={index} row={row} scope="row" />
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'blockquote':
      return (
        <blockquote>
          {node.blocks.map((block, index) => (
            <BlockNode key={index} node={block} headingOffset={headingOffset} />
          ))}
        </blockquote>
      );

    case 'code':
      return (
        <pre>
          <code>{node.text}</code>
        </pre>
      );

    case 'thematic-break':
      return <hr />;

    case 'figure':
      return <Figure node={node} />;
  }
}

function Row({
  row,
  defaultHeader = false,
  scope,
}: {
  row: ModelTableRow;
  defaultHeader?: boolean;
  scope: 'col' | 'row';
}): JSX.Element {
  return (
    <tr>
      {row.cells.map((cell, index) => {
        const isHeader = cell.header || defaultHeader;
        const span = {
          ...(cell.colSpan && cell.colSpan > 1 ? { colSpan: cell.colSpan } : {}),
          ...(cell.rowSpan && cell.rowSpan > 1 ? { rowSpan: cell.rowSpan } : {}),
        };
        // A cell can hold a figure or a nested list as well as text.
        const body = (
          <>
            <Inline nodes={cell.content} />
            {cell.blocks?.map((block, blockIndex) => (
              <BlockNode key={blockIndex} node={block} headingOffset={0} />
            ))}
          </>
        );

        return isHeader ? (
          <th key={index} scope={scope} {...span}>
            {body}
          </th>
        ) : (
          <td key={index} {...span}>
            {body}
          </td>
        );
      })}
    </tr>
  );
}

function Figure({
  node,
}: {
  node: Extract<DocumentNode, { type: 'figure' }>;
}): JSX.Element {
  const m = useMessages();
  const source = node.source;
  const hasImage = source?.kind === 'url';

  // The rule, and the reason for it:
  //
  //   Text the *document* supplied behaves like alternative text always has —
  //   it lives in the `alt` attribute, announced but not drawn.
  //
  //   Text *this tool* produced is drawn on the page. It is the tool's claim,
  //   not the author's, and a claim nobody can see is a claim nobody can
  //   check. Hiding a generated description in an attribute meant a sighted
  //   reader watching the feature run saw absolutely nothing happen — and the
  //   one person who could have caught a wrong description had no way to.
  const authorDecorative =
    node.alternativeText === '' && node.alternativeTextSource === 'author';
  const authorAlt =
    node.alternativeTextSource === 'author' && Boolean(node.alternativeText);
  const showsNotice = !hasImage || (!authorDecorative && !authorAlt);

  return (
    <figure className="apv-figure">
      {hasImage ? (
        <img
          src={source.url}
          // Empty whenever the notice below carries the text, so a screen
          // reader hears it once rather than twice.
          alt={figureAltText(node)}
          {...(source.width ? { width: source.width } : {})}
          {...(source.height ? { height: source.height } : {})}
        />
      ) : null}
      {showsNotice ? (
        <p className="apv-figure__placeholder">{figurePlaceholderText(m, node)}</p>
      ) : null}
      {node.caption ? <figcaption>{node.caption}</figcaption> : null}
    </figure>
  );
}

/**
 * The `alt` attribute for a figure whose image is shown.
 *
 * Only the author's own alternative text goes here. Anything this tool
 * produced is rendered as visible text instead, so `alt` is empty and the
 * image is skipped by assistive technology in favour of that text.
 */
export function figureAltText(node: Extract<DocumentNode, { type: 'figure' }>): string {
  return node.alternativeTextSource === 'author' ? (node.alternativeText ?? '') : '';
}

/**
 * The figure's text, and — when the text was not written by the author — who
 * did write it.
 *
 * A description cannot be checked against the picture by looking. The
 * prefix is the whole safeguard: `figures.withAlt` means the document said
 * this, `figures.withGeneratedAlt` means a machine guessed it — "Image:"
 * against "Image (description generated by AI):", and the same distinction in
 * every other locale. Losing
 * that distinction would be worse than having no description at all, because
 * a wrong description that reads as authoritative is not correctable by the
 * person relying on it.
 */
export function figurePlaceholderText(
  m: Messages,
  node: Extract<DocumentNode, { type: 'figure' }>,
): string {
  if (node.alternativeTextSource === 'generated' && node.alternativeText) {
    return m.figures.withGeneratedAlt(node.alternativeText);
  }
  if (node.alternativeTextSource === 'ocr' && node.alternativeText) {
    return m.figures.withOcrText(node.alternativeText);
  }
  // The document supplied it, but its word processor wrote it. Announcing that
  // as the author's own text would be false, and it is the case a reader is
  // least able to detect: it arrives in the same `/Alt` field a careful author
  // would have used.
  if (node.alternativeTextSource === 'document-ai' && node.alternativeText) {
    return m.figures.withDocumentAiAlt(node.alternativeText);
  }
  if (node.alternativeText) return m.figures.withAlt(node.alternativeText);

  // An empty alternative text means "decorative" — but who decided that
  // matters as much as the verdict itself. An author marking their own image
  // decorative is authoritative; a model guessing it is not, and saying so is
  // the difference between an informed reader and a silent gap.
  if (node.alternativeText === '' && node.alternativeTextSource === 'author') {
    return m.figures.decorative;
  }
  if (node.alternativeText === '' && node.alternativeTextSource) {
    return m.figures.decorativeGuess;
  }

  if (node.status === 'unavailable') return m.figures.unavailable;

  // "We tried and failed" is not the same as "nobody asked". Saying so stops
  // the reader wondering whether the description feature ran at all.
  if (node.descriptionAttempted) {
    return m.figures.describeFailed;
  }

  return m.figures.noAlt;
}

function Inline({ nodes }: { nodes: InlineNode[] }): JSX.Element {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineNodeView key={index} node={node} />
      ))}
    </>
  );
}

function InlineNodeView({ node }: { node: InlineNode }): JSX.Element | null {
  const m = useMessages();
  switch (node.type) {
    case 'text':
      return <>{applyEmphasis(node.text, node.emphasis ?? [])}</>;

    case 'line-break':
      return <br />;

    case 'link':
      return (
        <a href={node.href} target="_blank" rel="noopener noreferrer">
          <Inline nodes={node.content} />
          {/* Links leave the Reader, so say so. Announcing it only in the
              accessible name keeps the visual layout unchanged. */}
          <span className="apv-visually-hidden">{m.app.openInNewTab}</span>
        </a>
      );
  }
}

function applyEmphasis(
  text: string,
  emphasis: Array<'strong' | 'em' | 'code'>,
): ReactNode {
  return emphasis.reduce<ReactNode>((child, kind) => {
    switch (kind) {
      case 'strong':
        return <strong>{child}</strong>;
      case 'em':
        return <em>{child}</em>;
      case 'code':
        return <code>{child}</code>;
    }
  }, text);
}

function dropLeadingTitleHeading(
  pages: DocumentPage[],
  title: string,
): DocumentPage[] {
  const firstWithContent = pages.findIndex((page) => page.nodes.length > 0);
  if (firstWithContent === -1) return pages;

  const page = pages[firstWithContent]!;
  const [first] = page.nodes;
  if (
    first?.type !== 'heading' ||
    inlineToPlainText(first.content).trim() !== title.trim()
  ) {
    return pages;
  }

  return pages.map((candidate, index) =>
    index === firstWithContent
      ? { ...candidate, nodes: candidate.nodes.slice(1) }
      : candidate,
  );
}
