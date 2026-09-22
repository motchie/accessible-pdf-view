import { renderToStaticMarkup } from 'react-dom/server';
import { inLocale } from './helpers/messages';
import { describe, expect, it } from 'vitest';
import type { AccessibleDocument, DocumentNode } from '../lib/pdf/document-model';
import { DocumentView } from '../lib/reader/renderer';

/**
 * §30.3 — Document Model -> semantic HTML.
 *
 * These assert on the actual elements produced, because the elements are the
 * deliverable: `<h2>` is what puts an entry in the browser's heading list, and
 * `<th scope="col">` is what makes table navigation announce column names.
 */
function render(nodes: DocumentNode[], overrides: Partial<AccessibleDocument> = {}): Document {
  const document: AccessibleDocument = {
    metadata: { sourceUrl: null, pageCount: 1, producedBy: ['pdf-inspector'] },
    pages: [{ pageNumber: 1, origin: 'pdf-inspector', status: 'available', nodes }],
    ...overrides,
  };

  const html = renderToStaticMarkup(inLocale('ja', <DocumentView document={document} headingOffset={1} />));
  return new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
}

describe('Document Model -> semantic HTML', () => {
  it('renders headings shifted below the page h1', () => {
    const dom = render([
      { type: 'heading', level: 1, content: [{ type: 'text', text: 'Section' }] },
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'Subsection' }] },
    ]);

    expect(dom.querySelector('h2')?.textContent).toBe('Section');
    expect(dom.querySelector('h3')?.textContent).toBe('Subsection');
    // The document's own <h1> belongs to the page title, not the body.
    expect(dom.querySelector('h1')).toBeNull();
  });

  /**
   * The combined reading's headings are the author's words under an inferred
   * claim. The claim's producer travels on the element; nothing is announced
   * per heading, because the reading's own name says it once for all of them.
   */
  it('marks a node whose claim came from another producer', () => {
    const dom = render([
      { type: 'heading', level: 1, content: [{ type: 'text', text: '概要' }], origin: 'pdf-inspector' },
      { type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
    ]);
    expect(dom.querySelector('h2')?.getAttribute('data-origin')).toBe('pdf-inspector');
    expect(dom.querySelector('h2')?.textContent).toBe('概要');
    expect(dom.querySelector('p')?.hasAttribute('data-origin')).toBe(false);
  });

  it('clamps a heading that would exceed h6', () => {
    const dom = render([
      { type: 'heading', level: 6, content: [{ type: 'text', text: 'Deep' }] },
    ]);
    expect(dom.querySelector('h6')?.textContent).toBe('Deep');
  });

  it('renders paragraphs and native emphasis', () => {
    const dom = render([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'plain ' },
          { type: 'text', text: 'bold', emphasis: ['strong'] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'code', emphasis: ['code'] },
        ],
      },
    ]);

    expect(dom.querySelector('p strong')?.textContent).toBe('bold');
    expect(dom.querySelector('p code')?.textContent).toBe('code');
  });

  it('renders real list elements', () => {
    const dom = render([
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [
          { blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] },
          { blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] },
        ],
      },
    ]);

    const list = dom.querySelector('ol');
    expect(list).not.toBeNull();
    expect(list?.getAttribute('start')).toBe('3');
    expect(dom.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('renders a table with a scoped header row and a caption', () => {
    const dom = render([
      {
        type: 'table',
        caption: '表の見出し',
        header: {
          cells: [
            { header: true, content: [{ type: 'text', text: '項目' }] },
            { header: true, content: [{ type: 'text', text: '内容' }] },
          ],
        },
        rows: [
          {
            cells: [
              { header: false, content: [{ type: 'text', text: '電話' }] },
              { header: false, content: [{ type: 'text', text: '03-0000-0000' }] },
            ],
          },
        ],
      },
    ]);

    expect(dom.querySelector('table caption')?.textContent).toBe('表の見出し');
    const headers = [...dom.querySelectorAll('thead th')];
    expect(headers.map((cell) => cell.getAttribute('scope'))).toEqual(['col', 'col']);
    expect(dom.querySelectorAll('tbody td')).toHaveLength(2);
  });

  it('renders links as anchors and says that they open a new tab', () => {
    const dom = render([
      {
        type: 'paragraph',
        content: [
          {
            type: 'link',
            href: 'https://example.com/',
            content: [{ type: 'text', text: 'Example' }],
          },
        ],
      },
    ]);

    const anchor = dom.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/');
    expect(anchor?.getAttribute('rel')).toContain('noopener');
    expect(anchor?.textContent).toContain('新しいタブで開きます');
  });

  it('renders a figure placeholder that admits what it does not know', () => {
    const dom = render([{ type: 'figure', status: 'missing-alt' }]);

    const figure = dom.querySelector('figure');
    expect(figure).not.toBeNull();
    expect(figure?.textContent).toBe('画像があります。代替テキストを取得できませんでした。');
    // No <img> without pixels, and no invented description.
    expect(dom.querySelector('img')).toBeNull();
  });

  it('uses the document-supplied alternative text when there is one', () => {
    const dom = render([
      { type: 'figure', status: 'available', alternativeText: '作成者の説明', caption: '図1' },
    ]);

    expect(dom.querySelector('figure p')?.textContent).toBe('画像: 作成者の説明');
    expect(dom.querySelector('figcaption')?.textContent).toBe('図1');
  });

  it('never emits markup that came from the document text', () => {
    const dom = render([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '<img src=x onerror="alert(1)">' }],
      },
    ]);

    expect(dom.querySelector('img')).toBeNull();
    expect(dom.querySelector('p')?.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it('drops a body heading that only repeats the document title', () => {
    const dom = render(
      [
        { type: 'heading', level: 1, content: [{ type: 'text', text: 'Quarterly Report' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] },
      ],
      {
        metadata: {
          title: 'Quarterly Report',
          sourceUrl: null,
          pageCount: 1,
          producedBy: ['pdf-inspector'],
        },
      },
    );

    expect(dom.querySelector('h2')).toBeNull();
    expect(dom.querySelector('p')?.textContent).toBe('Body.');
  });

  it('marks page boundaries without polluting the heading outline', () => {
    const document: AccessibleDocument = {
      metadata: { sourceUrl: null, pageCount: 2, producedBy: ['pdf-inspector'] },
      pages: [
        {
          pageNumber: 1,
          origin: 'pdf-inspector',
          status: 'available',
          nodes: [{ type: 'paragraph', content: [{ type: 'text', text: 'One.' }] }],
        },
        {
          pageNumber: 2,
          origin: 'pdf-inspector',
          status: 'available',
          nodes: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two.' }] }],
        },
      ],
    };

    const html = renderToStaticMarkup(inLocale('ja', <DocumentView document={document} />));
    const dom = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');

    expect(dom.querySelector('.apv-page-break')?.textContent).toBe('2 ページ');
    expect(dom.querySelectorAll('h1, h2, h3, h4, h5, h6')).toHaveLength(0);
  });
});
