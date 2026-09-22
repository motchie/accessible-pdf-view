import type {
  AccessibleDocument,
  DocumentNode,
  FigureNode,
  InlineNode,
  TableRow,
} from '../pdf/document-model';
import { inlineToPlainText } from '../pdf/document-model';
import { figurePlaceholderText } from './renderer';
import type { Messages } from '../i18n';

/**
 * Document Model -> Markdown.
 *
 * The Markdown view used to show pdf-inspector's output verbatim, which stops
 * being the right answer once anything else contributes to the document. Two
 * things now diverge from it:
 *
 *   - A tagged PDF's structure comes from the tag tree, not from inference, so
 *     the raw Markdown describes a *worse* reading of the same document than
 *     the one on screen.
 *   - Generated figure descriptions do not exist in it at all.
 *
 * This serialises what the Reader actually renders. The raw output stays
 * available beside it, because "what did the parser produce" is a genuinely
 * different question from "what am I reading".
 *
 * Provenance survives the trip. A generated description is written with the
 * same `figures.withGeneratedAlt` prefix it is read with, in the same
 * language, so text
 * copied out of here cannot be mistaken for the author's own words once it is
 * somewhere else entirely.
 */
export interface MarkdownOptions {
  /** Emit `<!-- Page N -->` between pages, matching pdf-inspector. */
  includePageMarkers?: boolean;
  /** Write the document title as a level-1 heading. */
  includeTitle?: boolean;
}

/**
 * @param m The interface's messages. Markdown is the artefact that leaves this
 * extension, and the label saying a description was generated has to leave
 * with it — in the language the reader was reading, not a fixed one.
 */
export function documentToMarkdown(
  document: AccessibleDocument,
  m: Messages,
  options: MarkdownOptions = {},
): string {
  const includePageMarkers = options.includePageMarkers ?? true;
  const includeTitle = options.includeTitle ?? true;

  const blocks: string[] = [];
  const title = document.metadata.title?.trim();
  if (includeTitle && title) blocks.push(`# ${escapeText(title)}`);

  for (const page of document.pages) {
    if (includePageMarkers) blocks.push(`<!-- Page ${page.pageNumber} -->`);
    for (const node of page.nodes) {
      const rendered = blockToMarkdown(node, title ? 1 : 0, m);
      if (rendered) blocks.push(rendered);
    }
  }

  return `${blocks.join('\n\n')}\n`;
}

function blockToMarkdown(node: DocumentNode, headingOffset: number, m: Messages): string | null {
  switch (node.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, node.level + headingOffset));
      return `${'#'.repeat(level)} ${inlineToMarkdown(node.content)}`;
    }

    case 'paragraph':
    case 'unknown':
      return inlineToMarkdown(node.content) || null;

    case 'list':
      return listToMarkdown(node, 0, m);

    case 'table':
      return tableToMarkdown(node, m);

    case 'figure':
      return figureToMarkdown(node, m);

    case 'blockquote':
      return node.blocks
        .map((block) => blockToMarkdown(block, headingOffset, m))
        .filter((block): block is string => Boolean(block))
        .join('\n\n')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');

    case 'code':
      return `\`\`\`${node.language ?? ''}\n${node.text}\n\`\`\``;

    case 'thematic-break':
      return '---';
  }
}

/**
 * A figure becomes an image with its text as the alt.
 *
 * `image` as the target matches what pdf-inspector emits for a placeholder —
 * there is no file to link to, and inventing a path would be worse than an
 * obviously symbolic one.
 */
function figureToMarkdown(node: FigureNode, m: Messages): string {
  const label =
    node.alternativeTextSource === 'author' && node.alternativeText
      ? node.alternativeText
      : // Everything else — generated, OCR-read, or absent — is announced with
        // the same wording the Reader uses, so the provenance travels with the
        // text when it is copied somewhere this tool cannot annotate.
        figurePlaceholderText(m, node);

  const image = `![${escapeAlt(label)}](image)`;
  return node.caption ? `${image}\n\n*${escapeText(node.caption)}*` : image;
}

function listToMarkdown(
  node: Extract<DocumentNode, { type: 'list' }>,
  depth: number,
  m: Messages,
): string {
  const indent = '  '.repeat(depth);
  const start = node.start ?? 1;

  return node.items
    .map((item, index) => {
      const marker = node.ordered ? `${start + index}.` : '-';
      const body = item.blocks
        .map((block) =>
          block.type === 'list'
            ? listToMarkdown(block, depth + 1, m)
            : blockToMarkdown(block, 0, m),
        )
        .filter((block): block is string => Boolean(block))
        .join('\n\n');

      // Continuation lines line up under the marker so nested content stays
      // inside the item.
      const [first = '', ...rest] = body.split('\n');
      const continuation = rest.map((line) => (line ? `${indent}  ${line}` : line));
      return [`${indent}${marker} ${first}`, ...continuation].join('\n');
    })
    .join('\n');
}

/**
 * GFM tables cannot express everything the model holds: there is no syntax for
 * a row header (`<th scope="row">`), and a table without a header row still
 * needs a delimiter. Both are lost here, which is why the Reader — not this —
 * is the accessible output.
 */
function tableToMarkdown(node: Extract<DocumentNode, { type: 'table' }>, m: Messages): string {
  const columns = Math.max(
    node.header?.cells.length ?? 0,
    ...node.rows.map((row) => row.cells.length),
    1,
  );

  const header = node.header ?? { cells: [] };
  const lines = [
    rowToMarkdown(header, columns, m),
    `|${Array.from({ length: columns }, () => ' --- ').join('|')}|`,
    ...node.rows.map((row) => rowToMarkdown(row, columns, m)),
  ];

  const caption = node.caption ? `*${escapeText(node.caption)}*\n\n` : '';
  return caption + lines.join('\n');
}

function rowToMarkdown(row: TableRow, columns: number, m: Messages): string {
  const cells = Array.from({ length: columns }, (_unused, index) => {
    const cell = row.cells[index];
    if (!cell) return ' ';

    const parts = [
      inlineToMarkdown(cell.content),
      ...(cell.blocks ?? [])
        .map((block) => blockToMarkdown(block, 0, m))
        .filter((block): block is string => Boolean(block)),
    ].filter((part) => part !== '');

    // A cell is one line: a newline would end the row.
    const text = parts.join(' ').replace(/\s*\n+\s*/g, ' ').trim();
    return ` ${escapePipes(text) || ' '} `;
  });

  return `|${cells.join('|')}|`;
}

function inlineToMarkdown(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text': {
          const text = escapeText(node.text);
          return (node.emphasis ?? []).reduce((value, kind) => {
            switch (kind) {
              case 'strong':
                return `**${value}**`;
              case 'em':
                return `*${value}*`;
              case 'code':
                return `\`${value}\``;
            }
          }, text);
        }

        case 'link': {
          const label = inlineToMarkdown(node.content) || node.href;
          return `[${label}](${node.href})`;
        }

        case 'line-break':
          return '  \n';
      }
    })
    .join('')
    .trim();
}

/** Escapes only what would otherwise change the structure. Escaping every
 * special character would make Japanese prose unreadable in the source. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

function escapeAlt(text: string): string {
  return text.replace(/([\\[\]])/g, '\\$1').replace(/\n+/g, ' ');
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, '\\|');
}
