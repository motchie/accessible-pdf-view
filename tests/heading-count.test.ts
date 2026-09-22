import { describe, expect, it } from 'vitest';
import { countHeadings } from '../lib/pdf/document-model';
import type { AccessibleDocument, DocumentNode } from '../lib/pdf/document-model';

/**
 * The count exists because zero is a real answer and an invisible one.
 *
 * Every tagged fixture in this project — five Japanese business documents, all
 * from Microsoft Word — has a structure tree of paragraphs, tables, lists and
 * figures with **no heading tags at all**. A sighted reader sees headings; a
 * reader navigating by heading finds nothing, and cannot tell that from the
 * feature being broken.
 */
function text(value: string): DocumentNode {
  return { type: 'paragraph', content: [{ type: 'text', text: value }] };
}

function heading(level: 1 | 2 | 3): DocumentNode {
  return { type: 'heading', level, content: [{ type: 'text', text: `H${level}` }] };
}

function documentOf(...nodes: DocumentNode[][]): AccessibleDocument {
  return {
    metadata: { sourceUrl: null, pageCount: nodes.length, producedBy: ['pdf-inspector'] },
    pages: nodes.map((page, index) => ({
      pageNumber: index + 1,
      origin: 'pdf-inspector' as const,
      status: 'available' as const,
      nodes: page,
    })),
  };
}

describe('counting the headings a reading offers', () => {
  it('counts across pages', () => {
    expect(countHeadings(documentOf([heading(1), text('a')], [heading(2), heading(3)]))).toBe(3);
  });

  /** The measured case: real content, no headings. */
  it('returns zero for a document of paragraphs and tables', () => {
    const table: DocumentNode = {
      type: 'table',
      rows: [{ cells: [{ header: false, content: [{ type: 'text', text: '名称' }] }] }],
    };
    expect(countHeadings(documentOf([text('本文'), table]))).toBe(0);
  });

  /** A heading inside a list still lets `H` land on it, so it still counts. */
  it('finds headings nested in lists and blockquotes', () => {
    const list: DocumentNode = {
      type: 'list',
      ordered: false,
      items: [{ blocks: [heading(2)] }],
    };
    const quote: DocumentNode = { type: 'blockquote', blocks: [heading(3)] };

    expect(countHeadings(documentOf([list, quote]))).toBe(2);
  });

  it('is zero for an empty document rather than throwing', () => {
    expect(countHeadings(documentOf())).toBe(0);
    expect(countHeadings(documentOf([]))).toBe(0);
  });
});
