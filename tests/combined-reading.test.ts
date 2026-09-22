import { describe, expect, it } from 'vitest';
import type { AccessibleDocument, DocumentNode, DocumentOrigin, DocumentPage, InlineNode } from '../lib/pdf/document-model';
import { countHeadings, nodeOrigin, nodeToPlainText } from '../lib/pdf/document-model';
import { combineReadings, overlayHeadings } from '../lib/pdf/combined-reading';

/**
 * The third reading: the author's structure, with the headings it lacks.
 *
 * What these tests guard is the *refusals* as much as the placements. A
 * heading is placed only where the tagged reading has that exact text as a
 * node of its own or the start of one; every other case — a tagged document
 * with headings, text inside a list, text mid-paragraph, text that is not
 * there — leaves the author's structure exactly as it was.
 */
function paragraph(text: string): DocumentNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function heading(text: string, level: 1 | 2 | 3 = 2): Extract<DocumentNode, { type: 'heading' }> {
  return { type: 'heading', level, content: [{ type: 'text', text }] };
}

function page(origin: DocumentOrigin, nodes: DocumentNode[], pageNumber = 1): DocumentPage {
  return { pageNumber, origin, status: 'available', nodes };
}

function documentOf(origin: DocumentOrigin, ...pages: DocumentNode[][]): AccessibleDocument {
  return {
    metadata: { sourceUrl: null, pageCount: pages.length, producedBy: [origin] },
    pages: pages.map((nodes, index) => page(origin, nodes, index + 1)),
  };
}

/**
 * One page as both producers returned it, abridged.
 *
 * Neutral stand-ins: the document is third-party and is not published with
 * this repository. What was preserved is everything the code reacts to — the
 * letterhead the author left out of the tag tree, the heading that appears in
 * one reading and mid-paragraph in the other, and the space after 「①」 that
 * the two producers disagree about.
 */
const TAGGED = [
  paragraph('各位'),
  paragraph('差出人の行に続く、ふつうの本文です。'),
  paragraph('■見出し一'),
  paragraph('見出しの下にある、ふつうの本文です。'),
  paragraph('①丸数字のうしろの空白が読み方で違う'),
  paragraph('◆見出し二① 丸数字のうしろの空白が読み方で違う'),
  paragraph('最後の段落です。'),
];
const INFERRED = [
  heading('【NEWS RELEASE】', 1),
  paragraph('前付け 差出人一 差出人二'),
  heading('■見出し一'),
  paragraph('見出しの下にある本文です…'),
  heading('◆見出し二①丸数字のうしろの空白が読み方で違う'),
];

describe('the combined reading', () => {
  it('turns the tagged paragraphs that are headings into headings, and nothing else', () => {
    const combined = combineReadings(documentOf('tagged-pdf', TAGGED), documentOf('pdf-inspector', INFERRED));

    expect(combined).not.toBeNull();
    const nodes = combined!.pages[0]!.nodes;
    expect(nodes.map((node) => node.type)).toEqual([
      'paragraph',
      'paragraph',
      'heading',
      'paragraph',
      'paragraph',
      'heading',
      'paragraph',
    ]);
    // The words are the tagged reading's own — spacing included.
    expect(nodeToPlainText(nodes[5]!)).toBe(
      '◆見出し二① 丸数字のうしろの空白が読み方で違う',
    );
    expect(countHeadings(combined!)).toBe(2);
  });

  /** The letterhead the author kept out of the structure stays out. */
  it('drops an inferred heading that has no tagged counterpart', () => {
    const combined = combineReadings(documentOf('tagged-pdf', TAGGED), documentOf('pdf-inspector', INFERRED))!;
    expect(nodeToPlainText(combined.pages[0]!.nodes[0]!)).toBe('各位');
    expect(combined.pages[0]!.nodes.some((node) => nodeToPlainText(node).includes('NEWS RELEASE'))).toBe(false);
  });

  it('says on each placed heading where the claim came from, and nowhere else', () => {
    const combined = combineReadings(documentOf('tagged-pdf', TAGGED), documentOf('pdf-inspector', INFERRED))!;
    const first = combined.pages[0]!;

    for (const node of first.nodes) {
      expect(nodeOrigin(node, first)).toBe(node.type === 'heading' ? 'pdf-inspector' : 'tagged-pdf');
    }
    expect(first.origin).toBe('tagged-pdf');
    expect(combined.metadata.producedBy).toEqual(['tagged-pdf', 'pdf-inspector']);
  });

  it('carries the inferred level', () => {
    const combined = combineReadings(
      documentOf('tagged-pdf', [paragraph('Overview')]),
      documentOf('pdf-inspector', [heading('Overview', 3)]),
    )!;
    expect(combined.pages[0]!.nodes[0]).toMatchObject({ type: 'heading', level: 3 });
  });

  /**
   * The author's outline is the answer wherever there is one. An inferred
   * heading placed among real `H2`s would be a level claim with no basis.
   */
  it('does not exist for a document whose tags carry headings', () => {
    const tagged = documentOf('tagged-pdf', [heading('Introduction', 1), paragraph('Overview'), paragraph('Body.')]);
    const inferred = documentOf('pdf-inspector', [heading('Introduction', 1), heading('Overview')]);
    expect(combineReadings(tagged, inferred)).toBeNull();
  });

  it('does not exist when nothing could be placed', () => {
    const tagged = documentOf('tagged-pdf', [paragraph('本文だけです。')]);
    expect(combineReadings(tagged, documentOf('pdf-inspector', [heading('■見出し')]))).toBeNull();
    expect(combineReadings(tagged, documentOf('pdf-inspector', [paragraph('■見出し')]))).toBeNull();
  });

  /**
   * Measured: Word tagged the numbered sections as list items, with the
   * number in a label of its own. That is a disagreement between the two
   * readings, and it is reported rather than resolved — nothing inside a list
   * is touched.
   */
  it('leaves text inside a list alone', () => {
    const list: DocumentNode = {
      type: 'list',
      ordered: true,
      items: [{ blocks: [paragraph('見出し'), paragraph('SAMPLE グループは…')] }],
    };
    const tagged = documentOf('tagged-pdf', [paragraph('前文'), list]);
    const inferred = documentOf('pdf-inspector', [heading('１. 見出し'), heading('見出し')]);
    expect(combineReadings(tagged, inferred)).toBeNull();
  });

  it('never touches a page from another producer', () => {
    const tagged: AccessibleDocument = {
      metadata: { sourceUrl: null, pageCount: 1, producedBy: ['tagged-pdf', 'pdf-text'] },
      pages: [page('pdf-text', [paragraph('■見出し一')])],
    };
    expect(combineReadings(tagged, documentOf('pdf-inspector', [heading('■見出し一')]))).toBeNull();
  });
});

describe('placing headings among tagged nodes', () => {
  /**
   * A heading merged into its paragraph on the tagged side too — the tagged
   * `P` runs the heading straight into its paragraph — is split where the
   * heading's text stops, at the position in the *tagged* text.
   */
  it('splits a tagged paragraph that begins with the heading', () => {
    const nodes = [paragraph('■見出し一 見出しの下にある本文です。')];
    const out = overlayHeadings(nodes, [heading('■見出し一')]);

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      type: 'heading',
      level: 2,
      content: [{ type: 'text', text: '■見出し一' }],
      origin: 'pdf-inspector',
    });
    expect(out[1]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: '見出しの下にある本文です。' }],
    });
  });

  it('ignores whitespace the two producers disagree on', () => {
    const out = overlayHeadings([paragraph('2 0 2 6 年 7 月')], [heading('2026年7月')]);
    expect(out[0]?.type).toBe('heading');
    expect(nodeToPlainText(out[0]!)).toBe('2 0 2 6 年 7 月');
  });

  it('leaves text that begins mid-paragraph alone', () => {
    const nodes = [paragraph('前置きがあって ■見出し一 と続く。')];
    expect(overlayHeadings(nodes, [heading('■見出し一')])).toBe(nodes);
  });

  it('leaves text that spans two tagged nodes alone', () => {
    const nodes = [paragraph('4'), paragraph('26')];
    expect(overlayHeadings(nodes, [heading('4 26')])).toBe(nodes);
  });

  it('leaves a table, list or figure alone even when its text matches', () => {
    const table: DocumentNode = {
      type: 'table',
      rows: [{ cells: [{ header: false, content: [{ type: 'text', text: '概要' }] }] }],
    };
    const nodes = [table];
    expect(overlayHeadings(nodes, [heading('概要')])).toBe(nodes);
  });

  /** A repeated label is placed once per occurrence, in order. */
  it('moves forward through the page rather than matching the first occurrence twice', () => {
    const nodes = [paragraph('注'), paragraph('本文一'), paragraph('注'), paragraph('本文二')];
    const out = overlayHeadings(nodes, [heading('注'), heading('注')]);
    expect(out.map((node) => node.type)).toEqual(['heading', 'paragraph', 'heading', 'paragraph']);
  });

  it('keeps the tagged node’s links inside the heading', () => {
    const content: InlineNode[] = [
      { type: 'text', text: '◆' },
      { type: 'link', href: 'https://example.com/', content: [{ type: 'text', text: '見出し三' }] },
    ];
    const out = overlayHeadings([{ type: 'paragraph', content }], [heading('◆見出し三')]);
    expect(out[0]).toMatchObject({ type: 'heading', content });
  });

  it('does not split inside a link', () => {
    const content: InlineNode[] = [
      { type: 'link', href: 'https://example.com/', content: [{ type: 'text', text: '概要 本文' }] },
    ];
    const nodes: DocumentNode[] = [{ type: 'paragraph', content }];
    expect(overlayHeadings(nodes, [heading('概要')])).toBe(nodes);
  });
});
