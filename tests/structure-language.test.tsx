import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { settleDeclaredLanguages } from '../lib/pdf/declared-language';
import {
  chooseDocumentLanguages,
  writtenIn,
  type LanguagePreferences,
} from '../lib/pdf/document-language';
import type { AccessibleDocument, DocumentNode } from '../lib/pdf/document-model';
import { documentToPlainText } from '../lib/pdf/document-model';
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
  alt?: string;
  kids: Kid[];
}

const el = (role: string, ...kids: Kid[]): El => ({ role, kids });
const inLang = (lang: string, element: El): El => ({ ...element, lang });
const span = (lang: string, text: string): El => inLang(lang, el('Span', text));

/**
 * A one-page document with this tree, read by the tagged adapter and settled
 * as `decorate` settles it: against the catalog's language, or `detected` when
 * the catalog has none.
 */
async function read(catalogLanguage: string | undefined, ...kids: El[]): Promise<AccessibleDocument> {
  return readDetected(catalogLanguage, catalogLanguage, ...kids);
}

async function readDetected(
  catalogLanguage: string | undefined,
  detected: string | undefined,
  ...kids: El[]
): Promise<AccessibleDocument> {
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
      ...(kid.alt ? { alt: kid.alt } : {}),
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
  const document = extraction!.document;
  const settled = settleDeclaredLanguages(document, detected);
  return {
    ...settled,
    metadata: { ...settled.metadata, ...(detected ? { language: detected } : {}) },
  };
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
        // What the file declared stays on the run, so a language the reader
        // chooses later can be settled from it (#57).
        content: [
          { type: 'text', text: 'The first paragraph of the left column.', declaredLanguage: 'en' },
        ],
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

    expect(nodes(document)[0]).not.toHaveProperty('language');
    expect(html(document)).toBe('<p>Plain English.</p>');
  });

  it('treats a regional tag as the same language as its base', async () => {
    const document = await read(
      'en-US',
      el('P', span('en-US', 'One run'), span('en', ' and another.')),
      el('P', span('en-GB', 'Colour.')),
    );

    expect(html(document)).toBe('<p>One run and another.</p><p lang="en-GB">Colour.</p>');
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

  it('does not mark Japanese text whose block element declares English', async () => {
    const document = await read(
      'ja',
      inLang('en', el('P', '営業の状況')),
      inLang('en', el('H1', '概要')),
      el('Table', el('TR', inLang('en', el('TD', '部門')))),
    );

    expect(html(document)).toBe(
      '<p>営業の状況</p><h2>概要</h2>' +
        '<div class="apv-table-scroll" role="region" aria-label="表" tabindex="0"><table><tbody><tr><td>部門</td></tr></tbody></table>',
    );
  });

  it('does not mark a run declared English that mixes Latin and Japanese', async () => {
    const document = await read('ja', el('P', span('en', 'PDFを開く'), span('ja', '。')));

    expect(html(document)).toBe('<p>PDFを開く。</p>');
  });

  it('does not mark English words declared Japanese inside English', async () => {
    const document = await read('en', el('P', span('ja', 'Hello '), span('en', ' world.')));

    // The two runs join, and so do their spaces.
    expect(html(document)).toBe('<p>Hello world.</p>');
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

describe('settling', () => {
  it('gives a settled document back unchanged, as decorate runs more than once', async () => {
    const document = await read(
      'ja',
      el('P', span('ja', '名前は'), span('en', 'Accessible PDF View'), span('ja', 'です。')),
      el('P', span('en', 'All English.')),
      el('P', span('en', '2026'), span('zh', ' 年')),
    );

    expect(settleDeclaredLanguages(document, 'ja')).toEqual(document);
  });

  it("decides against the detected language when the catalog declares none", async () => {
    const document = await readDetected(undefined, 'ja', el('P', span('ja', '本日'), span('zh', '各位')));

    expect(html(document)).toBe('<p>本日各位</p>');
  });
});

/** The interface's own words inside the document (review of #50). */
describe("the interface's words inside a block in another language", () => {
  it("marks a link's new-tab notice in the interface language", async () => {
    const document = await read('ja', el('P', span('en', 'https://example.com/')));
    const withLink: AccessibleDocument = {
      ...document,
      pages: document.pages.map((page) => ({
        ...page,
        nodes: page.nodes.map((node) =>
          node.type === 'paragraph'
            ? { ...node, content: [{ type: 'link', href: 'https://example.com/', content: node.content }] }
            : node,
        ),
      })),
    };

    expect(html(withLink)).toBe(
      '<p lang="en"><a href="https://example.com/" target="_blank" rel="noopener noreferrer">' +
        'https://example.com/<span class="apv-visually-hidden" lang="ja">（新しいタブで開きます）</span></a></p>',
    );
  });

  it("marks a figure's notice in a cell of another language, but not one carrying alt text", async () => {
    const document = await read('ja', el('Table', el('TR', el('TD', span('en', 'Chart'), el('Figure')))));

    const markup = html(document);
    expect(markup).toContain('<td lang="en">Chart<figure');
    expect(markup).toContain('<p class="apv-figure__placeholder" lang="ja">');
  });

  it("marks a figure notice's own words and its alt text each in their language", async () => {
    const document = await read(
      'ja',
      el('Table', el('TR', el('TD', span('en', 'Chart'), { role: 'Figure', alt: 'Sales by month', kids: [] }))),
    );

    expect(html(document)).toContain(
      '<p class="apv-figure__placeholder" lang="ja">画像: <span lang="en">Sales by month</span></p>',
    );
  });

  it('leaves the notice unmarked where the document has no language', async () => {
    const document = await read(undefined, el('Figure'));

    expect(html(document)).toContain('<p class="apv-figure__placeholder">');
  });
});

/**
 * The page's title heading comes from the document information, which declares
 * no language. It takes one from the document's tags only when they show it.
 */
describe("the title's language", () => {
  async function titleLanguage(catalog: string, title: string, ...kids: El[]) {
    const document = await read(catalog, ...kids);
    return settleDeclaredLanguages(document, catalog, { title, tagsCoverText: true }).metadata.titleLanguage;
  }

  it('takes the language of a heading that says the same', async () => {
    expect(
      await titleLanguage(
        'ja',
        'Annual Report',
        el('H1', span('en', 'Annual Report')),
        el('P', span('ja', '本文です。')),
      ),
    ).toBe('en');
  });

  it('takes the language every run in the document agrees on', async () => {
    expect(
      await titleLanguage('ja', 'Reading order', el('P', span('en', 'First.')), el('P', span('en', 'Second.'))),
    ).toBe('en');
  });

  it('keeps the document’s when the runs disagree and nothing says the same', async () => {
    expect(
      await titleLanguage('ja', 'Reading order', el('P', span('en', 'First.')), el('P', span('ja', '二つ目。'))),
    ).toBeUndefined();
  });

  it("keeps the document's when the matching heading is in the document's language", async () => {
    expect(
      await titleLanguage('ja', '年次報告', el('H1', span('ja', '年次報告')), el('P', span('en', 'English.'))),
    ).toBeUndefined();
  });

  it('takes no unanimous language from tags that cover little of the page', async () => {
    const document = await read('ja', el('P', span('en', 'ACME Corporation')));
    expect(
      settleDeclaredLanguages(document, 'ja', { title: 'ACME Annual Report' }).metadata.titleLanguage,
    ).toBeUndefined();
    // A heading that says the same still decides it.
    const withHeading = await read('ja', el('H1', span('en', 'ACME Annual Report')));
    expect(
      settleDeclaredLanguages(withHeading, 'ja', { title: 'ACME Annual Report' }).metadata.titleLanguage,
    ).toBe('en');
  });

  it('does not mark a title with Japanese in it as English', async () => {
    expect(
      await titleLanguage('ja', 'PDF の読み方', el('P', span('en', 'All English.'))),
    ).toBeUndefined();
  });
});

/** The document's own language, for every reading (#49, #57). */
describe("the document's language", () => {
  async function decide(
    options: {
      catalog?: string;
      title?: string;
      covers?: boolean;
      tagged?: boolean;
      preferences?: LanguagePreferences;
    },
    ...kids: El[]
  ) {
    const document = await read(options.catalog, ...kids);
    const info = {
      isTagged: true,
      hasStructureTree: true,
      ...(options.title ? { title: options.title } : {}),
      ...(options.catalog ? { language: options.catalog } : {}),
    } as PdfDocumentInfo;
    const raw = new Map(options.tagged === false ? [] : [['tagged-pdf' as const, document]]);
    return chooseDocumentLanguages(
      {
        raw,
        info,
        found: options.catalog,
        taggedCoversText: options.covers ?? true,
        sample: documentToPlainText(document),
      },
      options.preferences ?? {},
    );
  }

  it("is the catalog's when the tags carry too little of the page text", async () => {
    // A declared Tagged PDF whose tree holds one English logo line, its
    // Japanese body untagged.
    expect(
      await decide({ catalog: 'ja', covers: false }, el('P', span('en', 'ACME Corporation'))),
    ).toEqual({ language: 'ja', source: 'catalog' });
  });

  it('is the one every run declares, over the catalog', async () => {
    expect(
      await decide(
        { catalog: 'ja', title: 'Reading order' },
        el('P', span('en', 'First.')),
        el('P', span('en', 'Second.')),
      ),
    ).toEqual({ language: 'en', source: 'tags' });
  });

  it("is the catalog's when the runs disagree", async () => {
    expect(
      await decide({ catalog: 'ja' }, el('P', span('en', 'First.')), el('P', span('ja', '二つ目。'))),
    ).toEqual({ language: 'ja', source: 'catalog' });
  });

  it("is the catalog's when the runs declare nothing", async () => {
    expect(await decide({ catalog: 'ja' }, el('P', '本文。'))).toEqual({
      language: 'ja',
      source: 'catalog',
    });
  });

  it("is the catalog's without a tagged reading", async () => {
    expect(await decide({ catalog: 'ja', tagged: false }, el('P', '本文。'))).toEqual({
      language: 'ja',
      source: 'catalog',
    });
  });

  it("gives the title its own only where it differs from the document's", async () => {
    expect(
      await decide(
        { catalog: 'ja', title: 'Annual Report' },
        el('H1', span('en', 'Annual Report')),
        el('P', span('ja', '本文です。')),
      ),
    ).toEqual({ language: 'ja', titleLanguage: 'en', source: 'catalog' });
  });

  describe("the reader's usual document language (#57)", () => {
    const romanian = 'Regulamentul privind accesibilitatea pentru studenții cu dizabilități.';

    it('replaces a catalog that is the only evidence, over text in its alphabet', async () => {
      expect(
        await decide({ catalog: 'en-US', preferences: { usual: 'ro' } }, el('P', romanian)),
      ).toEqual({ language: 'ro', source: 'usual' });
    });

    it('fills in for a PDF that declares no language', async () => {
      expect(
        await decide({ tagged: false, preferences: { usual: 'ro' } }, el('P', romanian)),
      ).toEqual({ language: 'ro', source: 'usual' });
    });

    it('leaves a PDF whose parts declare their languages', async () => {
      expect(
        await decide({ catalog: 'en', preferences: { usual: 'ro' } }, el('P', span('en', 'Annual report.'))),
      ).toEqual({ language: 'en', source: 'catalog' });
    });

    it('leaves a document written in another alphabet', async () => {
      expect(
        await decide({ catalog: 'en', preferences: { usual: 'ro' } }, el('P', 'これは日本語の文書です。')),
      ).toEqual({ language: 'en', source: 'catalog' });
    });

    it('leaves a document whose tags all declare one language', async () => {
      expect(
        await decide(
          { catalog: 'ja', preferences: { usual: 'ro' } },
          el('P', span('en', 'First.')),
          el('P', span('en', 'Second.')),
        ),
      ).toEqual({ language: 'en', source: 'tags' });
    });
  });

  describe("the reader's choice for this document (#57)", () => {
    it('wins over the catalog, the tags and the usual language', async () => {
      expect(
        await decide(
          { catalog: 'ja', preferences: { chosen: 'ro', usual: 'de' } },
          el('P', span('en', 'First.')),
          el('P', span('en', 'Second.')),
        ),
      ).toEqual({ language: 'ro', source: 'chosen' });
    });

    it("drops the file's part declarations, except another writing system's", async () => {
      const document = await read(
        'en',
        el('P', span('ro', 'Regulamentul '), span('es', '(UE) 2024/1263 al Parlamentului')),
        el('P', span('ro', 'Numele: '), span('ja', 'ひらがな')),
      );
      const chosen = settleDeclaredLanguages(document, 'ro', { chosen: true });
      const markup = renderToStaticMarkup(
        inLocale('ja', <DocumentView document={{ ...chosen, metadata: { ...chosen.metadata, language: 'ro' } }} />),
      ).replace(/<div class="apv-page"[^>]*>|<\/div>/g, '');

      expect(markup).toBe(
        '<p>Regulamentul (UE) 2024/1263 al Parlamentului</p><p>Numele: <span lang="ja">ひらがな</span></p>',
      );
    });

    it('can be undone, back to what the file says', async () => {
      const document = await read('ja', el('P', span('en', 'First.')), el('P', span('ja', '本文。')));
      const chosen = settleDeclaredLanguages(document, 'ro', { chosen: true });
      expect(settleDeclaredLanguages(chosen, 'ja')).toEqual(document);
    });
  });
});

describe('whether a text is written in a language’s alphabet', () => {
  it.each([
    ['Regulamentul universității', 'ro', true],
    ['Regulamentul universității', 'ru', false],
    ['Положение университета', 'ru', true],
    ['これは日本語です', 'ja', true],
    ['漢字だけ', 'ja', true],
    ['漢字', 'ja', false],
    ['漢字', 'zh', true],
    ['これは日本語です', 'ro', false],
    ['2026', 'ro', false],
  ])('%s in %s: %s', (text, language, expected) => {
    expect(writtenIn(text, language)).toBe(expected);
  });
});

/**
 * Switching readings re-renders the same positions with other blocks. A block
 * whose language changes must be a new element, not the old one with its
 * `lang` changed: Firefox keeps the language an element was created with (#40).
 */
describe('a change of language between readings', () => {
  it('creates a new element rather than changing lang on the old one', async () => {
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    const tagged = await read('ja', el('P', span('en', 'Hello.')), el('P', span('ja', '本文。')));
    const inferred: AccessibleDocument = {
      ...tagged,
      pages: tagged.pages.map((page) => ({
        ...page,
        nodes: page.nodes.map((node) => {
          if (node.type !== 'paragraph') return node;
          const { language: _dropped, ...rest } = node;
          return rest;
        }),
      })),
    };

    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => root.render(inLocale('ja', <DocumentView document={tagged} />)));
    const [englishBefore, japaneseBefore] = container.querySelectorAll('p');
    expect(englishBefore!.getAttribute('lang')).toBe('en');

    act(() => root.render(inLocale('ja', <DocumentView document={inferred} />)));
    const [englishAfter, japaneseAfter] = container.querySelectorAll('p');
    expect(englishAfter!.hasAttribute('lang')).toBe(false);
    expect(englishAfter).not.toBe(englishBefore);
    // A block whose language did not change keeps its element.
    expect(japaneseAfter).toBe(japaneseBefore);

    act(() => root.unmount());
  });
});
