import { describe, expect, it } from 'vitest';
import type { AccessibleDocument, DocumentNode, FigureNode } from '../lib/pdf/document-model';
import { collectFigures, mapFigures } from '../lib/pdf/document-model';
import { reconcileToCount } from '../lib/pdf/pdfjs/figure-regions';

/**
 * Figures are not always top-level.
 *
 * A real news release declares four figures and puts every one of them inside
 * a table cell. Because `TableCell` only held inline content, all four were
 * dropped before anything could see them — region attachment, the count in the
 * UI and the describer all agreed the document had no figures at all. These
 * tests pin the traversal that every one of those passes now shares, so a
 * figure can never be visible to one and invisible to another.
 */
function figure(overrides: Partial<FigureNode> = {}): FigureNode {
  return { type: 'figure', status: 'missing-alt', ...overrides };
}

describe('figure traversal', () => {
  const nodes: DocumentNode[] = [
    { type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
    figure({ alternativeText: 'top' }),
    {
      type: 'table',
      header: {
        cells: [{ header: true, content: [{ type: 'text', text: '見出し' }] }],
      },
      rows: [
        {
          cells: [
            {
              header: false,
              content: [{ type: 'text', text: 'セル内の見出し' }],
              blocks: [figure({ alternativeText: 'cell' })],
            },
          ],
        },
      ],
    },
    {
      type: 'list',
      ordered: false,
      items: [{ blocks: [figure({ alternativeText: 'list' })] }],
    },
  ];

  it('reaches figures in table cells and list items, in document order', () => {
    expect(collectFigures(nodes).map(({ figure: f }) => f.alternativeText)).toEqual([
      'top',
      'cell',
      'list',
    ]);
  });

  it('uses the surrounding cell text as context for a figure inside it', () => {
    const found = collectFigures(nodes);
    expect(found[1]?.context).toBe('セル内の見出し');
  });

  it('uses a short preceding paragraph as context for a top-level figure', () => {
    const found = collectFigures([
      { type: 'paragraph', content: [{ type: 'text', text: '（画像のキャプション）' }] },
      figure(),
    ]);
    expect(found[0]?.context).toBe('（画像のキャプション）');
  });

  it('rewrites nested figures in the same order it reports them', () => {
    const updated = mapFigures(nodes, (found, index) => ({
      ...found,
      alternativeText: `#${index}`,
    }));

    expect(collectFigures(updated).map(({ figure: f }) => f.alternativeText)).toEqual([
      '#0',
      '#1',
      '#2',
    ]);
    // The surrounding structure is preserved, not flattened.
    const table = updated[2];
    expect(table?.type).toBe('table');
    if (table?.type === 'table') {
      expect(table.header?.cells).toHaveLength(1);
      expect(table.rows[0]?.cells[0]?.content).toHaveLength(1);
    }
  });

  it('leaves a document with no nested figures untouched', () => {
    const flat: AccessibleDocument['pages'][number]['nodes'] = [
      { type: 'paragraph', content: [{ type: 'text', text: 'x' }] },
    ];
    expect(collectFigures(flat)).toHaveLength(0);
    expect(mapFigures(flat, (f) => f)).toEqual(flat);
  });
});

