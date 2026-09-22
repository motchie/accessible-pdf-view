import type { AccessibleDocument, DocumentNode } from './document-model';
import { countHeadings, inlineToPlainText } from './document-model';
import { splitInline } from './inline-split';
import { alignLines } from './text-alignment';

/**
 * The combined reading: the author's structure, with the headings it lacks.
 *
 * Every tagged document in this project's corpus has a structure tree with no
 * heading tags at all — the authors formatted their headings by hand, so Word
 * had nothing to tag. The tagged reading is still the better one: it has the
 * author's alternative text, the real tables, the artifacts kept out. But a
 * reader pressing `H` in it finds nothing, on a document that visibly has
 * sections. The inferred reading has those sections and loses everything else.
 *
 * This reading takes the tagged document as it is and puts into it only the
 * headings the inferred reading can prove are there. "Prove" is literal: an
 * inferred heading is used only when its text is found, whitespace aside,
 * **as a whole top-level tagged node or as the start of one**. Then the tagged
 * node becomes a heading, or is split into a heading and the paragraph that
 * followed it. The words are the tagged reading's own throughout, links and
 * all; the only thing added is the claim that this line is a heading, and that
 * claim carries its producer on the node (`origin: 'pdf-inspector'`).
 *
 * ## When it exists
 *
 * Only for a tagged document with **no headings of its own**. Where the author
 * used heading styles, their outline is the answer and nothing is added to it:
 * an inferred 「■」 line dropped among real `H2`s would be a level claim with no
 * basis — reporting a disagreement is a separate, unbuilt feature — and a
 * document whose tags say *these* are the
 * headings has already said the others are not. And only when at least one
 * heading was actually placed — a combined reading identical to the tagged one
 * would be a choice between two names for the same thing.
 *
 * ## What it declines, measured
 *
 * - **A two-page release**: the numbered sections are tagged as list items —
 *   Word tags auto-numbered paragraphs as `L`/`LI`, with the number in an
 *   `Lbl` — so a 「１.」 heading exists in the tagged reading only as its own
 *   text, without the number, inside a list. That is a genuine disagreement between the
 *   two readings (list, or sections?), and this file does not resolve it: the
 *   document gets no combined reading, and the Reader's existing notice still
 *   offers the inferred one with its three headings. Only top-level nodes are
 *   ever considered, on both sides.
 * - **A five-section release**: all five hand-formatted sections are their own tagged
 *   `P`, and become headings whole. The inferred 【NEWS RELEASE】 has no tagged
 *   counterpart — it is a letterhead the author kept out of the structure — and
 *   is dropped, which is the right answer.
 * - **The poster fixture**: the inferred reading's font-size headings include a
 *   lone year, and the tagged reading has that year as its own `P`, so the
 *   combined reading carries it as a heading too. This reading inherits the
 *   inferred reading's judgement about *which* lines are headings; what it adds
 *   is the check that the line exists as the author structured it. The tagged
 *   reading stays one switch away, and the picker says how many headings were
 *   added.
 *
 * Levels come from the inferred reading unchanged. There is nothing here to
 * read a level from, which is why these headings needed recovering.
 */
export function combineReadings(
  tagged: AccessibleDocument,
  inferred: AccessibleDocument,
): AccessibleDocument | null {
  if (countHeadings(tagged) > 0) return null;

  const inferredByPage = new Map(inferred.pages.map((page) => [page.pageNumber, page]));
  let placed = 0;

  const pages = tagged.pages.map((page) => {
    const counterpart = inferredByPage.get(page.pageNumber);
    if (!counterpart || page.origin !== 'tagged-pdf') return page;

    const headings = counterpart.nodes.filter(
      (node): node is Extract<DocumentNode, { type: 'heading' }> => node.type === 'heading',
    );
    if (headings.length === 0) return page;

    const nodes = overlayHeadings(page.nodes, headings);
    if (nodes === page.nodes) return page;
    placed += countPlaced(page.nodes, nodes);
    return { ...page, nodes };
  });

  if (placed === 0) return null;

  return {
    metadata: {
      ...tagged.metadata,
      producedBy: [...tagged.metadata.producedBy, 'pdf-inspector'],
    },
    pages,
  };
}

/**
 * Places inferred headings among a page's tagged nodes.
 *
 * The tagged nodes' texts stand in for the aligner's "lines", so a hit says
 * which node holds the heading and whether the heading is the whole of it.
 * Searching forward from the previous hit keeps a repeated label from landing
 * on its first occurrence twice.
 */
export function overlayHeadings(
  nodes: DocumentNode[],
  headings: ReadonlyArray<Extract<DocumentNode, { type: 'heading' }>>,
): DocumentNode[] {
  const texts = nodes.map((node) => (isTextBlock(node) ? inlineToPlainText(node.content) : ''));
  const aligner = alignLines(texts);

  // Node index -> what replaces it. Each node is claimed at most once.
  const replacements = new Map<number, DocumentNode[]>();
  let from = 0;

  for (const heading of headings) {
    const hit = aligner.locate(inlineToPlainText(heading.content), { from });
    if (!hit) continue;
    from = hit.end;

    // A whole node, or the start of one. Text that begins mid-node was grouped
    // by the author with what precedes it, and text that spans nodes is not
    // one line of anything.
    if (hit.startsMidLine || hit.firstLine !== hit.lastLine) continue;
    const index = hit.firstLine;
    const target = nodes[index];
    if (!target || !isTextBlock(target) || replacements.has(index)) continue;

    if (!hit.endsMidLine) {
      replacements.set(index, [
        { type: 'heading', level: heading.level, content: target.content, origin: 'pdf-inspector' },
      ]);
      continue;
    }

    const split = splitInline(target.content, aligner.offsetInLine(index, hit.endInLine));
    if (!split) continue;
    replacements.set(index, [
      { type: 'heading', level: heading.level, content: split.head, origin: 'pdf-inspector' },
      { type: 'paragraph', content: split.tail },
    ]);
  }

  if (replacements.size === 0) return nodes;
  return nodes.flatMap((node, index) => replacements.get(index) ?? [node]);
}

function isTextBlock(
  node: DocumentNode,
): node is Extract<DocumentNode, { type: 'paragraph' | 'unknown' }> {
  return node.type === 'paragraph' || node.type === 'unknown';
}

function countPlaced(before: DocumentNode[], after: DocumentNode[]): number {
  return after.filter((node) => node.type === 'heading').length - before.filter((node) => node.type === 'heading').length;
}

