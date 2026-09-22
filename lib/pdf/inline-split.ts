import type { InlineNode } from './document-model';

/**
 * Splits inline content at a plain-text offset, trimming the seam.
 *
 * Used wherever a line boundary found by `text-alignment.ts` has to be turned
 * into two nodes: a heading and the paragraph that was merged into it. The
 * offset is in the same coordinates as `inlineToPlainText` — a link counts by
 * its text, a line break as one character.
 *
 * Returns null rather than splitting inside a link: a link cut in two is two
 * links to the same place with half a label each, which is worse than one
 * merged paragraph. Also null when either side would be empty.
 */
export function splitInline(
  content: InlineNode[],
  offset: number,
): { head: InlineNode[]; tail: InlineNode[] } | null {
  const head: InlineNode[] = [];
  const tail: InlineNode[] = [];
  let consumed = 0;

  for (const node of content) {
    const length = lengthOf(node);
    if (consumed >= offset) {
      tail.push(node);
    } else if (consumed + length <= offset) {
      head.push(node);
    } else {
      // The offset falls inside this node.
      if (node.type !== 'text') return null;
      const at = offset - consumed;
      head.push({ ...node, text: node.text.slice(0, at) });
      tail.push({ ...node, text: node.text.slice(at) });
    }
    consumed += length;
  }

  const trimmedHead = trimEdge(head, 'end');
  const trimmedTail = trimEdge(tail, 'start');
  if (trimmedHead.length === 0 || trimmedTail.length === 0) return null;
  return { head: trimmedHead, tail: trimmedTail };
}

function lengthOf(node: InlineNode): number {
  switch (node.type) {
    case 'text':
      return node.text.length;
    case 'link':
      return node.content.reduce((sum, child) => sum + lengthOf(child), 0);
    case 'line-break':
      return 1;
  }
}

function trimEdge(nodes: InlineNode[], edge: 'start' | 'end'): InlineNode[] {
  const out = [...nodes];
  while (out.length > 0) {
    const index = edge === 'start' ? 0 : out.length - 1;
    const node = out[index]!;
    if (node.type === 'line-break') {
      out.splice(index, 1);
      continue;
    }
    if (node.type !== 'text') break;
    const text = edge === 'start' ? node.text.trimStart() : node.text.trimEnd();
    if (text === '') {
      out.splice(index, 1);
      continue;
    }
    out[index] = { ...node, text };
    break;
  }
  return out;
}
