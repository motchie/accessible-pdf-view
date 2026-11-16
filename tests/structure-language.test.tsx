import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { overlayHeadings } from '../lib/pdf/combined-reading';
import type { AccessibleDocument, DocumentNode } from '../lib/pdf/document-model';
import type { PdfDocumentInfo } from '../lib/pdf/pdfjs/metadata';
import { extractTaggedDocument } from '../lib/pdf/pdfjs/tagged-adapter';
import { DocumentView } from '../lib/reader/renderer';
import { inLocale } from './helpers/messages';

/**
 * The language a structure element declares (#49).
 *
 * A PDF's catalog `/Lang` is the language of whatever declares none; a
 * structure element's `/Lang` covers everything inside it. Word declares the
 * catalog's from the editing settings and every run's on its `Span`, so an
 * English document exported from a Japanese Word says `ja` for the file and
 * `en` on every run.
 *
 * The trees here are what PDF.js's `getStructTree` returns, built by hand with
 * a page whose text is what each marked-content section holds, so any text in
 * any script can be tested without a font that draws it.
 */

type Kid = El | string;
interface El {
  role: string;
  lang?: string;
  kids: Kid[];
}

const el = (role: string, ...kids: Kid[]): El => ({ role, kids });
const inLang = (lang: string, element: El): El => ({ ...element, lang });
const span = (lang: string, text: string): El => inLang(lang, el('Span', text));

/** A one-page document with this tree, read by the tagged adapter. */
async function read(catalogLanguage: string | undefined, ...kids: El[]): Promise<AccessibleDocument> {
  const items: unknown[] = [];
  let next = 0;
  const toNode = (kid: Kid): unknown => {
    if (typeof kid === 'string') {
      const id = `p1R_mc${next++}`;
      items.push(
        { type: 'beginMarkedContentProps', id },
        { str: kid, transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0 },
        { type: 'endMarkedContent' },
      );
      return { type: 'content', id };
    }
    return {
      role: kid.role,
      ...(kid.lang ? { lang: kid.lang } : {}),
      children: kid.kids.map(toNode),
    };
  };
  const tree = { role: 'Root', children: [toNode(el('Document', ...kids))] };

  const page = {
    getStructTree: async () => tree,
    getTextContent: async () => ({ items }),
    getAnnotations: async () => [],
    cleanup: () => {},
  };
  const pdf = { numPages: 1, getPage: async () => page } as unknown as PDFDocumentProxy;
  const info = {
    isTagged: true,
    hasStructureTree: true,
    ...(catalogLanguage ? { language: catalogLanguage } : {}),
  } as PdfDocumentInfo;

  const extraction = await extractTaggedDocument(pdf, { info });
  return extraction!.document;
}

function nodes(document: AccessibleDocument): DocumentNode[] {
  return document.pages.flatMap((page) => page.nodes);
}

/** The document as the Reader renders it, inside an article in its language. */
function html(document: AccessibleDocument): string {
  return renderToStaticMarkup(inLocale('ja', <DocumentView document={document} />))
    .replace(/<div class="apv-page"[^>]*>|<\/div>/g, '');
}

describe('a language declared on structure elements (#49)', () => {
  it("marks Word's English runs in a Japanese catalog as an English paragraph", async () => {
    const document = await read(
      'ja',
      el('P', span('en', 'The first paragraph'), span('en', ' of the left column.')),
    );

    expect(nodes(document)).toEqual([
      {
        type: 'paragraph',
        language: 'en',
        content: [{ type: 'text', text: 'The first paragraph of the left column.' }],
      },
    ]);
    expect(html(document)).toBe('<p lang="en">The first paragraph of the left column.</p>');
  });

  it('marks only the run that differs, when a block mixes languages', async () => {
    const document = await read(
      'en',
      el('P', span('en', 'The word '), span('fr', 'déjà vu'), span('en', ' is French.')),
    );

    expect(html(document)).toBe('<p>The word <span lang="fr">déjà vu</span> is French.</p>');
  });

  it('carries an element’s language to everything inside it', async () => {
    const document = await read(
      'ja',
      inLang(
        'en',
        el(
          'Sect',
          el('H1', 'Heading'),
          el('P', 'Body.'),
          el('L', el('LI', el('LBody', el('P', 'Item')))),
          el('Table', el('TR', el('TH', 'Head'), el('TD', 'Cell'))),
        ),
      ),
    );

    const markup = html(document);
    expect(markup).toContain(
      '<h2 lang="en">Heading</h2><p lang="en">Body.</p><ul><li><p lang="en">Item</p></li></ul>',
    );
    expect(markup).toContain('<th scope="row" lang="en">Head</th><td lang="en">Cell</td>');
  });

  it('marks table cells by their own language', async () => {
    const document = await read(
      'ja',
      el('Table', el('TR', inLang('en', el('TH', 'Head')), el('TD', '本文'))),
    );

    const markup = html(document);
    expect(markup).toContain('<th scope="row" lang="en">Head</th>');
    expect(markup).toContain('<td>本文</td>');
  });

  it('says nothing where the element declares the language already in force', async () => {
    const document = await read('en', el('P', span('en', 'Plain English.')));

    expect(nodes(document)[0]).toMatchObject({ language: 'en' });
    expect(html(document)).toBe('<p>Plain English.</p>');
  });

  it('lets a whitespace run neither split a block nor carry a language', async () => {
    const document = await read(
      'ja',
      el('P', span('en', 'Hello'), span('ja', ' '), span('en', 'world')),
    );

    expect(html(document)).toBe('<p lang="en">Hello world</p>');
  });

  it('ignores a declaration that is not a language tag', async () => {
    const document = await read('ja', el('P', span('not a tag!', 'テキスト')));

    expect(html(document)).toBe('<p>テキスト</p>');
  });
});

/**
 * Declarations the text cannot bear out. Each case is one measured in this
 * project's Japanese Word documents, where marking the run as declared would
 * have a screen reader change voice mid-sentence.
 */
describe('declarations a Japanese Word document makes but the text cannot show', () => {
  it('does not mark digits and punctuation, whatever they declare', async () => {
    const document = await read(
      'ja',
      el(
        'P',
        span('en', '2026'),
        span('zh', ' 年'),
        span('en', ' 5'),
        span('zh', ' 月'),
        span('en', ' 31'),
        span('zh', ' 日時点）'),
      ),
    );

    expect(html(document)).toBe('<p>2026年5月31日時点）</p>');
  });

  it('does not mark Han text declared Chinese inside Japanese', async () => {
    const document = await read('ja', el('P', span('zh', '見本商事株式会社')));

    expect(html(document)).toBe('<p>見本商事株式会社</p>');
  });

  it('does not mark Japanese text declared English', async () => {
    const document = await read(
      'ja',
      el('H1', span('en', '1. この文書の目的')),
      el('Table', el('TR', el('TD', span('en', '営業')))),
    );

    const markup = html(document);
    expect(markup).toContain('<h2>1. この文書の目的</h2>');
    expect(markup).toContain('<td>営業</td>');
  });

  it('marks Latin words declared English inside Japanese', async () => {
    const document = await read(
      'ja',
      el('P', span('ja', '名前は'), span('en', 'Accessible PDF View'), span('ja', 'です。')),
    );

    expect(html(document)).toBe(
      '<p>名前は<span lang="en">Accessible PDF View</span>です。</p>',
    );
  });

  it('keeps Japanese declared inside Chinese where kana show it', async () => {
    const document = await read('zh', el('P', span('ja', 'ひらがな')), el('P', span('ja', '漢字')));

    expect(html(document)).toBe('<p lang="ja">ひらがな</p><p>漢字</p>');
  });
});

describe('the combined reading', () => {
  it("keeps the tagged node's language when it makes the node a heading", () => {
    const overlaid = overlayHeadings(
      [
        { type: 'paragraph', language: 'en', content: [{ type: 'text', text: 'Introduction' }] },
        {
          type: 'paragraph',
          language: 'en',
          content: [{ type: 'text', text: 'Background The project began in spring.' }],
        },
      ],
      [
        { type: 'heading', level: 2, content: [{ type: 'text', text: 'Introduction' }] },
        { type: 'heading', level: 2, content: [{ type: 'text', text: 'Background' }] },
      ],
    );

    expect(overlaid).toEqual([
      expect.objectContaining({ type: 'heading', language: 'en' }),
      expect.objectContaining({ type: 'heading', language: 'en' }),
      expect.objectContaining({ type: 'paragraph', language: 'en' }),
    ]);
  });
});
