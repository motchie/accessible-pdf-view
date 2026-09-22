import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OPS } from 'pdfjs-dist';
import { describe, expect, it } from 'vitest';
import type { AccessibleDocument, PdfCapabilities } from '../lib/pdf/document-model';
import { chooseOutputLanguage } from '../lib/pdf/describe/output-language';
import { detectScriptLanguage } from '../lib/pdf/pdfjs/language';
import { classifyPageContent, classifyPages } from '../lib/pdf/pdfjs/page-content';
import { mergeOcrPages, ocrPagesRead } from '../lib/pdf/ocr/merge';
import {
  OcrPageNotice,
  OcrRequiredNotice,
  pageContentExplanation,
} from '../lib/reader/components/Notices';
import { MessagesProvider } from '../lib/i18n';
import { en } from '../lib/i18n/en';
import { ja } from '../lib/i18n/ja';

/** These assertions were written against the Japanese originals and still
 * check the same sentences; the locale is now explicit rather than implied. */
/** Renders a notice in Japanese, which is what these assertions check. */
const inJapanese = (element: ReactElement) =>
  renderToStaticMarkup(createElement(MessagesProvider, { locale: 'ja' as const }, element));

const explain = (
  kind: Parameters<typeof pageContentExplanation>[1],
  causes?: Parameters<typeof pageContentExplanation>[2],
) => pageContentExplanation(ja, kind, causes);
import { classifyAlternativeText } from '../lib/pdf/pdfjs/generated-alt';
import { describableFigures } from '../lib/pdf/describe/run-describe';
import { figureAltText, figurePlaceholderText } from '../lib/reader/renderer';
/** The provenance labels these tests exist for, in the locale they were
 * written against. `figurePlaceholderText` takes its messages so that the same
 * assertions can be made in either one — see the English pass below. */
const placeholder = (node: Parameters<typeof figurePlaceholderText>[1]) =>
  figurePlaceholderText(ja, node);

/**
 * Three fixes to one complaint: a page that yields no text was described as
 * "an image" whether or not it contained one, there was no way to OCR it, and
 * a document that declares no language was described in English.
 */

function fakePage(fnArray: number[]) {
  return {
    getOperatorList: async () => ({ fnArray, argsArray: fnArray.map(() => []) }),
    cleanup: () => {},
  } as never;
}

describe('classifying a page that produced no text', () => {
  it('calls a page with a raster image an image', async () => {
    const page = fakePage([OPS.constructPath, OPS.paintImageXObject, OPS.constructPath]);
    expect(await classifyPageContent(page)).toBe('image');
  });

  it('counts an image mask as an image', async () => {
    expect(await classifyPageContent(fakePage([OPS.paintImageMaskXObject]))).toBe('image');
  });

  /**
   * The case that prompted all of this: a slide deck exported with its text
   * converted to outlines. Hundreds of paths, not one image — so saying "this
   * page is displayed as an image" was false, and contradicted the figure
   * detector finding nothing there.
   */
  it('calls a page of nothing but paths vector, not an image', async () => {
    const page = fakePage(Array.from({ length: 206 }, () => OPS.constructPath));
    expect(await classifyPageContent(page)).toBe('vector');
  });

  it('does not call a page with a rule and a border a diagram', async () => {
    const page = fakePage([OPS.constructPath, OPS.constructPath, OPS.setFillRGBColor]);
    expect(await classifyPageContent(page)).toBe('blank');
  });

  it('classifies only the pages asked for', async () => {
    const asked: number[] = [];
    const pdf = {
      getPage: async (pageNumber: number) => {
        asked.push(pageNumber);
        return fakePage([OPS.paintImageXObject]);
      },
    };

    const kinds = await classifyPages(pdf as never, [3, 7]);
    expect(asked).toEqual([3, 7]);
    expect(kinds.get(3)).toBe('image');
    expect(kinds.get(7)).toBe('image');
  });
});

describe('what the reader is told about such a page', () => {
  it('mentions an image only when there is one', () => {
    expect(explain('image')).toContain('画像として保存されている');
    expect(explain('vector')).toContain('図形');
    expect(explain('vector')).toContain('画像は含まれていません');
    expect(explain('image')).not.toContain('図形');
  });

  it('claims nothing when the page was never classified', () => {
    const text = explain(undefined);
    expect(text).toContain('テキストを取得できませんでした');
    expect(text).not.toContain('画像');
  });

  it('does not offer OCR for a page that is genuinely empty', () => {
    expect(explain('blank')).not.toContain('OCR');
  });
});

describe('choosing the language a description is written in', () => {
  it("uses the document's own language when it has one", () => {
    expect(chooseOutputLanguage('ja-JP', { browserLanguages: ['en-US'] })).toEqual({
      language: 'ja',
      source: 'document',
      from: 'ja-JP',
    });
  });

  /** The bug: a Japanese PDF with no /Lang, read in a Japanese browser, was
   * described in English. */
  it("falls back to the browser's language, not English, when the document is silent", () => {
    expect(chooseOutputLanguage(undefined, { browserLanguages: ['ja', 'en'] })).toEqual({
      language: 'ja',
      source: 'browser',
      from: 'ja',
    });
  });

  it('skips browser languages the model cannot write', () => {
    expect(chooseOutputLanguage(undefined, { browserLanguages: ['ko', 'fr-CA'] })).toEqual({
      language: 'fr',
      source: 'browser',
      from: 'fr-CA',
    });
  });

  it('reaches English only when nothing else is usable, and says so', () => {
    expect(chooseOutputLanguage(undefined, { browserLanguages: ['ko'] })).toEqual({
      language: 'en',
      source: 'default',
    });
  });

  it('still reports the declared language when the model cannot write it', () => {
    // The UI needs `from` to explain *why* the answer is English.
    expect(chooseOutputLanguage('zh-Hans', { browserLanguages: ['ja'] })).toEqual({
      language: 'en',
      source: 'document',
      from: 'zh-Hans',
    });
  });

  /**
   * The case none of the rules above can reach: a document that declares a
   * language, declares it confidently, and declares the wrong one. Nothing in
   * the file betrays that — the file is the part that is wrong — so the
   * reader's own answer has to win, and has to be reported as theirs.
   */
  it("takes the reader's own choice over the document's declaration", () => {
    expect(
      chooseOutputLanguage('en', { preferred: 'ja', browserLanguages: ['en-US'] }),
    ).toEqual({ language: 'ja', source: 'setting' });
  });

  it('takes it over the browser too, not only the document', () => {
    expect(
      chooseOutputLanguage(undefined, { preferred: 'en', browserLanguages: ['ja'] }),
    ).toEqual({ language: 'en', source: 'setting' });
  });

  /** No `from`: there is no tag this came from, and filling one in would
   * attribute the reader's answer to the document. */
  it("never presents the reader's choice as something the document said", () => {
    expect(chooseOutputLanguage('en', { preferred: 'ja' })).not.toHaveProperty('from');
  });
});

describe('guessing a language from the writing system', () => {
  it('recognises kana as Japanese', () => {
    expect(detectScriptLanguage('かな交じりの見出しです')).toBe('ja');
    expect(detectScriptLanguage('カタカナ')).toBe('ja');
  });

  it('recognises hangul as Korean', () => {
    expect(detectScriptLanguage('안녕하세요')).toBe('ko');
  });

  /** Han characters are shared by Chinese, Japanese and Korean. Guessing
   * commits a screen reader to a pronunciation for the whole document, so a
   * wrong guess is worse than none. */
  it('refuses to guess from Han characters alone', () => {
    expect(detectScriptLanguage('文書構造解析結果')).toBeNull();
  });

  it('says nothing about Latin text', () => {
    expect(detectScriptLanguage('Annual report 2026')).toBeNull();
  });
});

describe('merging OCR results into the document on screen', () => {
  const base: AccessibleDocument = {
    metadata: { sourceUrl: null, pageCount: 3, producedBy: ['pdf-inspector'] },
    pages: [
      {
        pageNumber: 1,
        origin: 'pdf-inspector',
        status: 'available',
        nodes: [{ type: 'paragraph', content: [{ type: 'text', text: '元からある本文' }] }],
      },
      { pageNumber: 2, origin: 'pdf-inspector', status: 'requires-ocr', nodes: [] },
      { pageNumber: 3, origin: 'pdf-inspector', status: 'requires-ocr', nodes: [] },
    ],
  };

  function ocrDocument(pages: AccessibleDocument['pages']): AccessibleDocument {
    return {
      metadata: { sourceUrl: null, pageCount: 3, producedBy: ['ocr'] },
      pages,
    };
  }

  it('replaces only the page it read', () => {
    const merged = mergeOcrPages(
      base,
      ocrDocument([
        {
          pageNumber: 2,
          origin: 'ocr',
          status: 'available',
          nodes: [{ type: 'paragraph', content: [{ type: 'text', text: '読み取った文字' }] }],
        },
      ]),
    );

    expect(merged.pages[0]).toBe(base.pages[0]);
    expect(merged.pages[1]!.status).toBe('available');
    expect(merged.pages[1]!.origin).toBe('ocr');
    expect(merged.pages[2]).toBe(base.pages[2]);
    expect(merged.metadata.producedBy).toEqual(['pdf-inspector', 'ocr']);
  });

  /**
   * "OCR read nothing" is not the same claim as "the page is empty", and only
   * the first one is true. Overwriting would turn a page we could not read into
   * a page we assert has nothing on it.
   */
  it('leaves a page OCR could not read exactly as it was', () => {
    const merged = mergeOcrPages(
      base,
      ocrDocument([{ pageNumber: 2, origin: 'ocr', status: 'requires-ocr', nodes: [] }]),
    );

    expect(merged).toBe(base);
    expect(merged.pages[1]!.status).toBe('requires-ocr');
  });

  it("never overwrites the document's own text", () => {
    const merged = mergeOcrPages(
      base,
      ocrDocument([
        {
          pageNumber: 1,
          origin: 'ocr',
          status: 'available',
          nodes: [{ type: 'paragraph', content: [{ type: 'text', text: '誤読したかもしれない文字' }] }],
        },
      ]),
    );

    expect(merged.pages[0]!.origin).toBe('pdf-inspector');
    expect(merged.pages[0]!.nodes).toEqual(base.pages[0]!.nodes);
  });

  it('reports which pages were actually read', () => {
    const result = ocrDocument([
      {
        pageNumber: 2,
        origin: 'ocr',
        status: 'available',
        nodes: [{ type: 'paragraph', content: [{ type: 'text', text: 'あり' }] }],
      },
      { pageNumber: 3, origin: 'ocr', status: 'requires-ocr', nodes: [] },
    ]);

    expect(ocrPagesRead(result)).toEqual([2]);
  });
});

/**
 * A `/Alt` is not proof that a person wrote it.
 *
 * Found in a release whose only figure carried Word's own alternative text,
 * disclaimer included, copied into the PDF verbatim — the Japanese of
 *
 *     Image containing timeline
 *
 *     AI-generated content may be incorrect.
 *
 * Treating it as the author's own words made the Reader announce it as
 * authoritative and made the describe panel skip the image entirely — the one
 * figure in the document that most needed a second opinion was the one figure
 * that could not be offered one.
 */
describe("telling a person's alternative text from their word processor's", () => {
  it('recognises the current Office AI disclaimer, in Japanese', () => {
    expect(
      classifyAlternativeText(
        'タイムライン が含まれている画像\n\nAI 生成コンテンツは誤りを含む可能性があります。',
      ),
    ).toEqual({ text: 'タイムライン が含まれている画像', machineWritten: true });
  });

  it('recognises it in English', () => {
    expect(
      classifyAlternativeText('A chart showing quarterly results\n\nAI-generated content may be incorrect.'),
    ).toEqual({ text: 'A chart showing quarterly results', machineWritten: true });
  });

  it('recognises the older Office wording, which ran into the description', () => {
    expect(classifyAlternativeText('グラフ、散布図、自動的に生成された説明')).toEqual({
      text: 'グラフ、散布図',
      machineWritten: true,
    });
    expect(
      classifyAlternativeText('A picture containing text, Description automatically generated'),
    ).toEqual({ text: 'A picture containing text', machineWritten: true });
  });

  /** The more damaging mistake of the two: demoting text a person wrote. Only
   * the vendor's exact boilerplate counts as evidence. */
  it("leaves a human's description alone, however it is phrased", () => {
    expect(classifyAlternativeText('2026年度の売上推移を示す折れ線グラフ。第3四半期に急増。')).toEqual({
      text: '2026年度の売上推移を示す折れ線グラフ。第3四半期に急増。',
      machineWritten: false,
    });
    // Mentioning AI is not the same as being written by one.
    expect(classifyAlternativeText('AI導入率の推移を示す棒グラフ').machineWritten).toBe(false);
  });

  it('treats whitespace-only alt as no description at all', () => {
    // Word emits alt=" " for decorative spacing.
    expect(classifyAlternativeText(' ')).toEqual({ text: '', machineWritten: false });
    expect(classifyAlternativeText(undefined)).toEqual({ text: '', machineWritten: false });
  });

  it('keeps the description when the disclaimer is all there is to remove', () => {
    expect(classifyAlternativeText('AI 生成コンテンツは誤りを含む可能性があります。')).toEqual({
      text: '',
      machineWritten: true,
    });
  });
});

describe('what the Reader does with word-processor alt text', () => {
  const figure = {
    type: 'figure' as const,
    status: 'available' as const,
    alternativeText: 'タイムライン が含まれている画像',
    alternativeTextSource: 'document-ai' as const,
    region: { pageNumber: 1, bbox: { x: 0, y: 0, width: 100, height: 100 } },
  };

  it('names the word processor rather than the author', () => {
    const text = placeholder(figure);
    expect(text).toContain('文書作成ソフトが自動生成した説明');
    expect(text).toContain('タイムライン が含まれている画像');
  });

  /** `alt` is for text the document's author supplied. Machine text is drawn
   * instead, so a sighted reviewer can see what the reader is being told. */
  it('keeps it out of the alt attribute', () => {
    expect(figureAltText(figure)).toBe('');
  });

  it('offers it for description, unlike the author\'s own words', () => {
    const withMachineAlt = documentWithFigures([figure]);
    expect(describableFigures(withMachineAlt)).toEqual({
      total: 1,
      missing: 0,
      machineWritten: 1,
    });

    const withAuthorAlt = documentWithFigures([
      { ...figure, alternativeTextSource: 'author' as const },
    ]);
    expect(describableFigures(withAuthorAlt).total).toBe(0);
  });
});

function documentWithFigures(figures: AccessibleDocument['pages'][number]['nodes']) {
  return {
    metadata: { sourceUrl: null, pageCount: 1, producedBy: ['tagged-pdf' as const] },
    pages: [
      { pageNumber: 1, origin: 'tagged-pdf' as const, status: 'available' as const, nodes: figures },
    ],
  };
}

describe('the producer’s own reason for a page', () => {
  /**
   * The case that made this worth carrying. A page whose font has no usable
   * ToUnicode map has text on it — it is neither a picture nor outlines — so
   * the wording drawn from what the page *paints* would send a reader looking
   * for something that is not there. The first two pages of an untagged
   * prospectus in the local corpus are exactly this, and pdf-inspector says so.
   */
  it('describes undecodable text as undecodable, not as a picture', () => {
    const text = explain(undefined, ['garbled-text']);

    expect(text).toContain('フォントの情報が壊れている');
    expect(text).toContain('OCR');
    expect(text).not.toContain('画像として保存されている');
    expect(text).not.toContain('図形');
  });

  it('wins over what the page turned out to be painted with', () => {
    // Classification looked at the page and called it an image; the producer
    // that actually failed to read it said the text is undecodable. The
    // producer is closer to the failure.
    expect(explain('image', ['garbled-text'])).toContain('フォント');
    // And for the causes that do agree, the two say the same thing.
    expect(explain(undefined, ['vector-text'])).toBe(
      explain('vector'),
    );
    expect(explain(undefined, ['scanned'])).toBe(explain('image'));
    expect(explain(undefined, ['no-text'])).toBe(explain('blank'));
  });

  it('falls back to looking at the page when no cause was given', () => {
    expect(explain('vector', [])).toBe(explain('vector'));
    expect(explain(undefined, [])).toContain('取得できませんでした');
  });
});

/**
 * Where the OCR notice points.
 *
 * It moved into the header, so it is now on screen in every view rather than
 * only in the Reader tab. The one line in it that sends the reader somewhere
 * else has to know that: "the Original view can show you the pages" is a
 * route from the Reader and
 * from Markdown, and from Original it is an instruction to go where they
 * already are.
 */
describe('the OCR-required notice', () => {
  const capabilities = {
    requiresOcr: true,
    ocrPages: [3, 4],
    hasEncodingIssues: false,
  } as PdfCapabilities;

  it('offers the original view from everywhere else', () => {
    const html = inJapanese(createElement(OcrRequiredNotice, { capabilities, viewingOriginal: false }));
    expect(html).toContain('OCR が必要です');
    expect(html).toContain('オリジナルタブ');
  });

  it('does not send the reader to the view they are already in', () => {
    const html = inJapanese(createElement(OcrRequiredNotice, { capabilities, viewingOriginal: true }));
    // Everything else it has to say is still said.
    expect(html).toContain('3, 4 ページ');
    expect(html).not.toContain('オリジナルタブ');
  });
});

/**
 * What a page says after OCR has read it.
 *
 * Two claims, and the second one is new: the text is a machine's reading, and
 * — when figures had to be moved to the end to survive the merge — the order
 * on this page is no longer the document's. Both are things that cannot be
 * checked against the page by looking, so both are said where the page is read
 * rather than once in a panel.
 */
describe('the OCR-read page notice', () => {
  it('labels the text as machine-read', () => {
    const html = inJapanese(createElement(OcrPageNotice, { pageNumber: 3 }));
    expect(html).toContain('OCR（機械による文字認識）');
    expect(html).not.toContain('うしろにまとめています');
  });

  it('says when the figures on it were moved, and why', () => {
    const html = inJapanese(createElement(OcrPageNotice, { pageNumber: 3, carriedFigures: 2 }));
    expect(html).toContain('画像 2 件は本文のうしろにまとめています');
    expect(html).toContain('位置の情報がない');
  });
});
