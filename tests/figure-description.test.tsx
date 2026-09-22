import { renderToStaticMarkup } from 'react-dom/server';
import { inLocale } from './helpers/messages';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Rasterising a region needs a real PDF.js page and a real canvas. These tests
// are about the provenance and control flow around the describer, so the
// renderer is stubbed and the actual cropping is covered by the fixture test.
vi.mock('../lib/pdf/pdfjs/region-raster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/pdf/pdfjs/region-raster')>()),
  renderRegionToBlob: vi.fn(async () => new Blob(['stub'], { type: 'image/png' })),
}));

import type { AccessibleDocument, DocumentNode, FigureNode } from '../lib/pdf/document-model';
import { collectFigures } from '../lib/pdf/document-model';
import { ChromeAiFigureDescriber, interpret } from '../lib/pdf/describe/chrome-ai-describer';
import { ChromeAiOcrProvider } from '../lib/pdf/ocr/chrome-ai-provider';
import type { FigureDescriber } from '../lib/pdf/describe/provider';
import { countDescribableFigures, describeFigures } from '../lib/pdf/describe/run-describe';
import { mergeDescriptions } from '../lib/pdf/describe/merge';
import {
  isOutputLanguageSupported,
  resolveOutputLanguage,
} from '../lib/pdf/describe/output-language';
import { toBlocks } from '../lib/pdf/ocr/chrome-ai-provider';
import { DocumentView, figureAltText, figurePlaceholderText } from '../lib/reader/renderer';
import { en } from '../lib/i18n/en';
import { ja } from '../lib/i18n/ja';

/** The provenance labels these tests exist for, in the locale they were
 * written against. `figurePlaceholderText` takes its messages so that the same
 * assertions can be made in either one — see the English pass below. */
const placeholder = (node: Parameters<typeof figurePlaceholderText>[1]) =>
  figurePlaceholderText(ja, node);
import {
  describeLanguageNote,
  describeStatusMessage,
} from '../lib/reader/components/DescribeFiguresPanel';

/** Japanese, which is what these assertions were written against. The helper
 * takes its messages so the same wording can be checked in either locale. */
const status = (run: Parameters<typeof describeStatusMessage>[1]) => describeStatusMessage(ja, run);

/**
 * The safeguard these tests exist for: a machine-generated description must
 * never reach a reader as the author's own words. Someone who cannot see the
 * image cannot check a description against the picture, so provenance is the
 * only thing standing between "useful guess" and "false statement about the
 * document".
 */

function figure(overrides: Partial<FigureNode> = {}): FigureNode {
  return { type: 'figure', status: 'missing-alt', ...overrides };
}

function documentWith(nodes: DocumentNode[]): AccessibleDocument {
  return {
    metadata: { sourceUrl: null, pageCount: 1, producedBy: ['pdf-inspector'] },
    pages: [{ pageNumber: 1, origin: 'pdf-inspector', status: 'available', nodes }],
  };
}

describe('alternative text provenance', () => {
  it('announces an author-written alt text without qualification', () => {
    const node = figure({
      alternativeText: '作成者の説明',
      alternativeTextSource: 'author',
      status: 'available',
    });
    expect(placeholder(node)).toBe('画像: 作成者の説明');
    expect(figureAltText(node)).toBe('作成者の説明');
  });

  it('marks a generated description as generated, everywhere it is read', () => {
    const node = figure({
      alternativeText: '生成された説明',
      alternativeTextSource: 'generated',
      status: 'available',
    });

    expect(placeholder(node)).toBe(
      '画像（AIによる自動生成の説明）: 生成された説明',
    );
    // A generated description is drawn on the page, not tucked into `alt` —
    // so `alt` is empty and the visible text carries it.
    expect(figureAltText(node)).toBe('');
  });

  it('distinguishes text read off the image from a description of it', () => {
    const node = figure({
      alternativeText: '画像内の文字',
      alternativeTextSource: 'ocr',
      status: 'available',
    });
    expect(placeholder(node)).toBe('画像（画像内から読み取った文字）: 画像内の文字');
  });

  it('keeps saying it does not know when nothing described the figure', () => {
    expect(placeholder(figure())).toBe(
      '画像があります。代替テキストを取得できませんでした。',
    );
  });

  it('reports a decorative image as having no content, not as unknown', () => {
    const node = figure({
      alternativeText: '',
      alternativeTextSource: 'generated',
      status: 'available',
    });
    expect(placeholder(node)).toContain('AIは装飾的な画像と判定');
    expect(figureAltText(node)).toBe('');
  });

  it('keeps announcing an undescribed figure once its image is shown', () => {
    // Regression: rendering the picture replaced the placeholder, so an
    // undescribed figure became an `<img alt="">` — silent to a screen reader.
    // Showing the image to sighted users must not remove the announcement.
    const html = renderToStaticMarkup(inLocale('ja', <DocumentView
        document={documentWith([figure({ source: { kind: 'url', url: 'blob:test' } })])}
      />));
    const dom = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');

    expect(dom.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(dom.querySelector('.apv-figure__placeholder')?.textContent).toBe(
      '画像があります。代替テキストを取得できませんでした。',
    );
  });

  it('draws a generated description on the page rather than hiding it in alt', () => {
    // Regression: the description went into `alt` only, so the feature
    // produced good descriptions that nobody could see. A generated claim
    // that cannot be read is a claim that cannot be checked.
    const html = renderToStaticMarkup(inLocale('ja', <DocumentView
        document={documentWith([
          figure({
            alternativeText: '子どもたちが作業する部屋',
            alternativeTextSource: 'generated',
            status: 'available',
            source: { kind: 'url', url: 'blob:test' },
          }),
        ])}
      />));
    const dom = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');

    expect(dom.querySelector('.apv-figure__placeholder')?.textContent).toBe(
      '画像（AIによる自動生成の説明）: 子どもたちが作業する部屋',
    );
    // Empty so the text is announced once, from the paragraph.
    expect(dom.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it("keeps the author's own alternative text in alt, where it belongs", () => {
    const html = renderToStaticMarkup(inLocale('ja', <DocumentView
        document={documentWith([
          figure({
            alternativeText: '作成者の説明',
            alternativeTextSource: 'author',
            status: 'available',
            source: { kind: 'url', url: 'blob:test' },
          }),
        ])}
      />));
    const dom = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');

    // The document's own alt text behaves exactly like alt text anywhere else.
    expect(dom.querySelector('img')?.getAttribute('alt')).toBe('作成者の説明');
    expect(dom.querySelector('.apv-figure__placeholder')).toBeNull();
  });

  it('uses a short paragraph beside a figure as context for the describer', async () => {
    const seen: Array<string | undefined> = [];
    const capturing: FigureDescriber = {
      id: 'capture',
      displayName: 'capture',
      sendsDataExternally: false,
      experimental: true,
      async isAvailable() {
        return { status: 'available' };
      },
      async describe(input) {
        seen.push(input.caption);
        return { description: 'x', decorative: false, providerId: 'capture' };
      },
    };

    await describeFigures({
      document: documentWith([
        { type: 'paragraph', content: [{ type: 'text', text: '（ロゴ画像 ※注記つき）' }] },
        figure({ region: { pageNumber: 1, bbox: { x: 0, y: 0, width: 10, height: 10 } } }),
      ]),
      pdf: { getPage: vi.fn(async () => ({ cleanup: vi.fn() })) } as never,
      describer: capturing,
    });

    // The fixture labels its figures with sibling paragraphs, not captions.
    expect(seen[0]).toBe('（ロゴ画像 ※注記つき）');
  });

  it('does not feed a whole body paragraph in as a caption', async () => {
    const seen: Array<string | undefined> = [];
    const capturing: FigureDescriber = {
      id: 'capture',
      displayName: 'capture',
      sendsDataExternally: false,
      experimental: true,
      async isAvailable() {
        return { status: 'available' };
      },
      async describe(input) {
        seen.push(input.caption);
        return { description: 'x', decorative: false, providerId: 'capture' };
      },
    };

    await describeFigures({
      document: documentWith([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'あ'.repeat(200) }],
        },
        figure({ region: { pageNumber: 1, bbox: { x: 0, y: 0, width: 10, height: 10 } } }),
      ]),
      pdf: { getPage: vi.fn(async () => ({ cleanup: vi.fn() })) } as never,
      describer: capturing,
    });

    expect(seen[0]).toBeUndefined();
  });

  it('carries the provenance into the rendered HTML', () => {
    const html = renderToStaticMarkup(inLocale('ja', <DocumentView
        document={documentWith([
          figure({
            alternativeText: '写真の説明',
            alternativeTextSource: 'generated',
            status: 'available',
            source: { kind: 'url', url: 'blob:test' },
          }),
        ])}
      />));
    const dom = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');

    expect(dom.querySelector('figure')?.textContent).toContain('AIによる自動生成の説明');
    expect(dom.querySelector('figure')?.textContent).toContain('写真の説明');
  });
});

describe('describeFigures', () => {
  const describer: FigureDescriber = {
    id: 'stub',
    displayName: 'stub',
    sendsDataExternally: false,
    experimental: true,
    async isAvailable() {
      return { status: 'available' };
    },
    async describe() {
      return { description: 'もう一つの生成された説明', decorative: false, providerId: 'stub' };
    },
  };

  const pdf = {
    getPage: vi.fn(async () => ({ cleanup: vi.fn() })),
  } as unknown as Parameters<typeof describeFigures>[0]['pdf'];

  const region = { pageNumber: 1, bbox: { x: 0, y: 0, width: 100, height: 100 } };

  it('never writes a description without also recording that it was generated', async () => {
    const result = await describeFigures({
      document: documentWith([figure({ region })]),
      pdf,
      describer,
    });

    const described = result.document.pages[0]!.nodes[0]!;
    if (described.type !== 'figure') throw new Error('expected a figure');

    expect(described.alternativeText).toBe('もう一つの生成された説明');
    // The pair is the invariant. A description without this is a false claim
    // about the document.
    expect(described.alternativeTextSource).toBe('generated');
  });

  it('never overwrites text the author supplied', async () => {
    const authored = figure({
      alternativeText: '作者による説明',
      alternativeTextSource: 'author',
      status: 'available',
      region,
    });

    const result = await describeFigures({
      document: documentWith([authored]),
      pdf,
      describer,
    });

    expect(result.described).toBe(0);
    expect(result.document.pages[0]!.nodes[0]).toMatchObject({
      alternativeText: '作者による説明',
      alternativeTextSource: 'author',
    });
  });

  it('refuses to run a describer that transmits data without consent', async () => {
    const hosted: FigureDescriber = { ...describer, sendsDataExternally: true };

    await expect(
      describeFigures({ document: documentWith([figure({ region })]), pdf, describer: hosted }),
    ).rejects.toThrow(/consent/);

    // And runs once consent is given.
    const allowed = await describeFigures({
      document: documentWith([figure({ region })]),
      pdf,
      describer: hosted,
      consentGiven: true,
    });
    expect(allowed.described).toBe(1);
  });

  it('makes a decorative verdict visible in the document', async () => {
    // Regression: the decorative branch set the empty text but not the source,
    // so the renderer could not tell it apart from an undescribed figure — a
    // run that classified every image looked like a run that did nothing.
    const decorativeDescriber: FigureDescriber = {
      ...describer,
      async describe() {
        return { description: null, decorative: true, providerId: 'stub' };
      },
    };

    const result = await describeFigures({
      document: documentWith([figure({ region })]),
      pdf,
      describer: decorativeDescriber,
    });

    expect(result.decorative).toBe(1);
    const node = result.document.pages[0]!.nodes[0]!;
    if (node.type !== 'figure') throw new Error('expected a figure');

    expect(node.alternativeText).toBe('');
    expect(node.alternativeTextSource).toBe('generated');
    // A machine's verdict is announced as a machine's verdict — never applied
    // silently the way an author's empty `/Alt` would be.
    expect(placeholder(node)).toContain('AIは装飾的な画像と判定');
    expect(placeholder(node)).toContain('誤っている可能性');
  });

  it('never leaves a figure with no text at all after a run', async () => {
    // Regression: an AI "decorative" verdict suppressed both the alt and the
    // placeholder, so the figure went from saying something to saying nothing.
    const decorativeDescriber: FigureDescriber = {
      ...describer,
      async describe() {
        return { description: null, decorative: true, providerId: 'stub' };
      },
    };

    const result = await describeFigures({
      document: documentWith([
        figure({ region, source: { kind: 'url', url: 'blob:test' } }),
      ]),
      pdf,
      describer: decorativeDescriber,
    });

    const html = renderToStaticMarkup(inLocale('ja', <DocumentView document={result.document} />));
    const dom = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');

    expect(dom.querySelector('figure')?.textContent?.trim()).not.toBe('');
    expect(dom.querySelector('.apv-figure__placeholder')?.textContent).toContain(
      'AIは装飾的な画像と判定',
    );
  });

  it('still hides an image the author marked decorative', () => {
    // An author's empty alt text *is* authoritative — that one stays silent.
    const authored = figure({
      alternativeText: '',
      alternativeTextSource: 'author',
      status: 'available',
      source: { kind: 'url', url: 'blob:test' },
    });
    const html = renderToStaticMarkup(inLocale('ja', <DocumentView document={documentWith([authored])} />));
    const dom = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');

    expect(dom.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(dom.querySelector('.apv-figure__placeholder')).toBeNull();
  });

  it('records an outcome for every figure, successes included', async () => {
    const result = await describeFigures({
      document: documentWith([figure({ region }), figure({ region })]),
      pdf,
      describer,
    });

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0]).toMatchObject({ outcome: 'described', pageNumber: 1 });
  });

  it('records why each figure failed instead of only counting them', async () => {
    const failing: FigureDescriber = {
      ...describer,
      async describe() {
        return { description: null, decorative: false, providerId: 'stub', rawReply: '  ' };
      },
    };

    const result = await describeFigures({
      document: documentWith([figure({ region })]),
      pdf,
      describer: failing,
    });

    expect(result.failed).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ pageNumber: 1, indexOnPage: 0 });
    expect(result.failures[0]!.reason).toContain('empty reply');
  });

  it('tells the reader it tried, rather than reverting to "never asked"', async () => {
    const failing: FigureDescriber = {
      ...describer,
      async describe() {
        throw new Error('model unavailable');
      },
    };

    const result = await describeFigures({
      document: documentWith([figure({ region })]),
      pdf,
      describer: failing,
    });

    const node = result.document.pages[0]!.nodes[0]!;
    if (node.type !== 'figure') throw new Error('expected a figure');

    expect(node.descriptionAttempted).toBe(true);
    expect(placeholder(node)).toBe(
      '画像があります。内容を解析しましたが、説明を生成できませんでした。',
    );
    expect(result.failures[0]!.reason).toContain('model unavailable');
  });

  it('does not retry a figure a previous run already failed on', async () => {
    // `descriptionAttempted` alone must not make it describable again — but a
    // fresh document still should be.
    const attempted = documentWith([figure({ region, descriptionAttempted: true })]);
    expect(countDescribableFigures(attempted)).toBe(1);
  });

  it('gives up on a figure that never comes back, instead of hanging the run', async () => {
    // Regression: a describe() that never settles left the run stuck at
    // "generating…" forever, with no result and no way to tell why.
    const hanging: FigureDescriber = {
      ...describer,
      describe: vi
        .fn()
        .mockResolvedValueOnce({
          description: '最初の画像',
          decorative: false,
          providerId: 'stub',
        })
        .mockImplementation(() => new Promise(() => {})),
    };

    const result = await describeFigures({
      document: documentWith([figure({ region }), figure({ region })]),
      pdf,
      describer: hanging,
      timeoutMs: 20,
    });

    expect(result.described).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0]!.reason).toContain('No reply within');
  });

  it('publishes each description as it lands, not only at the end', async () => {
    const emitted: number[] = [];
    const slowSecond: FigureDescriber = {
      ...describer,
      describe: vi
        .fn()
        .mockResolvedValueOnce({ description: '1枚目', decorative: false, providerId: 'stub' })
        .mockImplementation(() => new Promise(() => {})),
    };

    await describeFigures({
      document: documentWith([figure({ region }), figure({ region })]),
      pdf,
      describer: slowSecond,
      timeoutMs: 20,
      onFigureResolved: (partial) => {
        emitted.push(
          partial.pages[0]!.nodes.filter(
            (node) => node.type === 'figure' && Boolean(node.alternativeText),
          ).length,
        );
      },
    });

    // The first figure's description is visible before the second resolves —
    // a stalled figure no longer strands the work already done.
    expect(emitted[0]).toBe(1);
  });

  it('counts only figures that can actually be described', () => {
    const document = documentWith([
      figure({ region }), // describable
      figure(), // no region — nothing to send
      figure({ alternativeText: 'x', alternativeTextSource: 'author', region }), // authored
    ]);
    expect(countDescribableFigures(document)).toBe(1);
  });

  it('keeps going when one figure fails', async () => {
    const flaky: FigureDescriber = {
      ...describer,
      describe: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ description: 'ok', decorative: false, providerId: 'stub' }),
    };

    const result = await describeFigures({
      document: documentWith([figure({ region }), figure({ region })]),
      pdf,
      describer: flaky,
    });

    expect(result.failed).toBe(1);
    expect(result.described).toBe(1);
  });
});

describe('output language', () => {
  // Chrome rejects a session with no declared output language:
  // "No output language was specified in a LanguageModel API request."
  it('reduces a BCP-47 tag to the primary subtag the API accepts', () => {
    expect(resolveOutputLanguage('ja')).toBe('ja');
    expect(resolveOutputLanguage('ja-JP')).toBe('ja');
    expect(resolveOutputLanguage('en-US')).toBe('en');
    expect(resolveOutputLanguage('DE')).toBe('de');
    expect(resolveOutputLanguage('fr_CA')).toBe('fr');
  });

  it('falls back to English rather than failing on an unsupported language', () => {
    // A description in the wrong language still beats no description.
    expect(resolveOutputLanguage('zh-Hans')).toBe('en');
    expect(resolveOutputLanguage('ko')).toBe('en');
    expect(resolveOutputLanguage(undefined)).toBe('en');
    expect(resolveOutputLanguage('')).toBe('en');
  });

  it('reports whether the document language is one the model can write', () => {
    expect(isOutputLanguageSupported('ja-JP')).toBe(true);
    expect(isOutputLanguageSupported('ko')).toBe(false);
    expect(isOutputLanguageSupported(undefined)).toBe(false);
  });
});

describe('Chrome AI reply handling', () => {
  it('treats the decorative token as "nothing to say"', () => {
    expect(interpret('DECORATIVE', 'chrome-ai')).toMatchObject({
      description: null,
      decorative: true,
    });
  });

  it('strips the labels and quotes models add despite instructions', () => {
    expect(interpret('Alt text: "A red bicycle."', 'chrome-ai').description).toBe(
      'A red bicycle.',
    );
    expect(interpret('代替テキスト: 「赤い自転車」', 'chrome-ai').description).toBe('赤い自転車');
  });

  it('reports an empty reply as no description rather than an empty one', () => {
    expect(interpret('   ', 'chrome-ai')).toMatchObject({ description: null, decorative: false });
  });

  it('splits an OCR reply into paragraphs without inferring structure', () => {
    expect(toBlocks('一段落目です。\n\n二段落目です。')).toEqual([
      { type: 'paragraph', text: '一段落目です。' },
      { type: 'paragraph', text: '二段落目です。' },
    ]);
  });

  it('reports an EMPTY page as having no blocks, so it stays flagged for OCR', () => {
    expect(toBlocks('EMPTY')).toEqual([]);
    expect(toBlocks('')).toEqual([]);
  });
});


describe('Chrome AI session configuration', () => {
  const original = globalThis.LanguageModel;

  afterEach(() => {
    globalThis.LanguageModel = original;
  });

  function stubLanguageModel() {
    const availability = vi.fn(async (_options?: Record<string, unknown>) => 'available' as const);
    const prompt = vi.fn(async () => 'ロゴの説明');
    const session = {
      prompt,
      promptStreaming: vi.fn(),
      append: vi.fn(),
      clone: vi.fn(async () => session),
      destroy: vi.fn(),
      contextWindow: 4096,
      contextUsage: 0,
    } as unknown as LanguageModelSession;
    const create = vi.fn(async (_options?: Record<string, unknown>) => session);

    globalThis.LanguageModel = {
      availability,
      create,
      params: vi.fn(async () => null),
    } as unknown as LanguageModelStatic;

    return { availability, create, prompt };
  }

  /**
   * Chrome rejects any LanguageModel request that does not declare an output
   * language — including the availability probe, which is easy to overlook
   * because it is not the call that produces text. Missing it logged
   * "No output language was specified in a LanguageModel API request" on every
   * Reader load.
   */
  it('declares an output language on the describer probe and session alike', async () => {
    const { availability, create } = stubLanguageModel();
    const describer = new ChromeAiFigureDescriber();

    await describer.isAvailable({ language: 'ja-JP' });
    await describer.describe({
      image: new Blob(['x']),
      pageNumber: 1,
      indexOnPage: 0,
      language: 'ja-JP',
    });

    const expected = [{ type: 'text', languages: ['ja'] }];
    expect(availability.mock.calls[0]?.[0]).toMatchObject({ expectedOutputs: expected });
    expect(create.mock.calls[0]?.[0]).toMatchObject({ expectedOutputs: expected });
  });

  it('declares an output language on the OCR probe and session alike', async () => {
    const { availability, create } = stubLanguageModel();
    const provider = new ChromeAiOcrProvider();

    await provider.isAvailable({ languages: ['ja'] });
    await provider.analyze(
      { pages: [{ pageNumber: 1, image: new Blob(['x']) }] },
      { languages: ['ja'] },
    );

    const expected = [{ type: 'text', languages: ['ja'] }];
    expect(availability.mock.calls[0]?.[0]).toMatchObject({ expectedOutputs: expected });
    expect(create.mock.calls[0]?.[0]).toMatchObject({ expectedOutputs: expected });
  });

  it('keeps working when the session cannot be cloned', async () => {
    // Cloning is an isolation optimisation; losing it must not fail the run.
    const { create } = stubLanguageModel();
    const session = await (globalThis.LanguageModel as LanguageModelStatic).create();
    (session.clone as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no clone'));
    create.mockClear();

    const describer = new ChromeAiFigureDescriber();
    const result = await describer.describe({
      image: new Blob(['x']),
      pageNumber: 1,
      indexOnPage: 0,
      language: 'ja',
    });

    expect(result.description).toBe('ロゴの説明');
    // The shared session must survive — destroying it would break every
    // figure after this one.
    expect(session.destroy).not.toHaveBeenCalled();
  });
});

/**
 * What the describe panel says while it is working.
 *
 * The run publishes each description as it lands (above), so the status line is
 * the reader's only account of what is *not* done yet. It used to count a
 * figure as it was picked up and present that as a completed total — "5 / 5"
 * while the fifth was still being described.
 */
describe('the describe panel’s progress line', () => {
  it('says which figure is in flight, not how many are finished', () => {
    expect(
      status({ phase: 'running', total: 5, started: 2, pageNumber: 3 }),
    ).toBe('3 ページ目の画像を説明しています…（5 件中 2 件目）');
  });

  it('drops the fraction when there is only one figure to describe', () => {
    expect(
      status({ phase: 'running', total: 1, started: 1, pageNumber: 7 }),
    ).toBe('7 ページ目の画像を説明しています…');
  });

  /** The download line goes through the same ten steps as everywhere else, so
   * a multi-gigabyte download is ten announcements rather than a hundred. */
  it('reports the model download in steps, not in every value it gets', () => {
    expect(status({ phase: 'preparing', loaded: 0 })).toBe('AIモデルを準備しています…');
    expect(status({ phase: 'preparing', loaded: 0.09 })).toBe('AIモデルを準備しています…');
    expect(status({ phase: 'preparing', loaded: 0.37 })).toBe('AIモデルを準備しています… 30%');
  });

  it('claims nothing about a run that has not reached its first figure', () => {
    expect(
      status({ phase: 'running', total: 5, started: 0, pageNumber: null }),
    ).toBe('画像の説明を生成しています…');
  });
});

/**
 * Where the language came from, which the panel has to say out loud.
 *
 * Four answers reach this sentence and only one of them is the document's own
 * declaration. The rest are a guess about the reader, an admission that the
 * model cannot write what was asked for, and the reader overruling the file —
 * and a description in the wrong language is not something anyone can catch by
 * looking at the picture.
 */
describe('the describe panel’s language note', () => {
  it("attributes the document's own declaration to the document", () => {
    const note = describeLanguageNote(ja, {
      language: 'ja',
      source: 'document',
      from: 'ja-JP',
    });
    expect(note).toContain('説明は日本語で生成されます。');
    expect(note).toContain('ja-JP');
  });

  it('says a guess is a guess when the document declares nothing', () => {
    const note = describeLanguageNote(ja, { language: 'ja', source: 'browser', from: 'ja' });
    expect(note).toContain('ブラウザの言語設定');
    expect(note).not.toContain('この文書の言語');
  });

  it('says so when the reader has overruled the document', () => {
    const note = describeLanguageNote(ja, { language: 'ja', source: 'setting' });
    expect(note).toContain('説明は日本語で生成されます。');
    expect(note).toContain('設定により');
    // Never as the document's own answer: overruling a document that declares
    // the wrong language is the entire reason the setting exists.
    expect(note).not.toContain('この文書の言語');
  });

  it('says the same thing in English, which is the base language', () => {
    expect(describeLanguageNote(en, { language: 'ja', source: 'setting' })).toBe(
      'Descriptions will be written in Japanese. Your settings say to use the interface language rather than the one this document declares.',
    );
  });
});

/**
 * Two long runs against one document.
 *
 * A describe run works from the document it was handed and republishes that
 * whole snapshot with every figure. OCR now lands pages one at a time, and both
 * panels sit in the header together with neither disabling the other — so the
 * snapshot was rolling read pages back to their unread state, one figure at a
 * time. `mergeDescriptions` carries only what the run did.
 */
describe('folding descriptions into the document on screen', () => {
  const region = { pageNumber: 1, bbox: { x: 0, y: 0, width: 100, height: 100 } };
  const other = { pageNumber: 1, bbox: { x: 0, y: 0, width: 50, height: 50 } };

  function twoPages(first: DocumentNode[], second: DocumentNode[]): AccessibleDocument {
    return {
      metadata: { sourceUrl: null, pageCount: 2, producedBy: ['pdf-inspector'] },
      pages: [
        { pageNumber: 1, origin: 'pdf-inspector', status: 'available', nodes: first },
        { pageNumber: 2, origin: 'pdf-inspector', status: 'requires-ocr', nodes: second },
      ],
    };
  }

  const described = figure({
    region,
    alternativeText: '屋上菜園の写真',
    alternativeTextSource: 'generated',
    status: 'available',
  });

  it('does not undo a page OCR read while the run was working', () => {
    // What the run started from: page 2 unread.
    const snapshot = twoPages([figure({ region })], []);
    // What is on screen now: OCR finished page 2 a moment ago.
    const live = twoPages([figure({ region })], [
      { type: 'paragraph', content: [{ type: 'text', text: 'OCRで読み取った本文' }] },
    ]);
    live.pages[1] = { ...live.pages[1]!, origin: 'ocr', status: 'available' };

    const merged = mergeDescriptions(live, { ...snapshot, pages: [
      { ...snapshot.pages[0]!, nodes: [described] },
      snapshot.pages[1]!,
    ] });

    // The description arrived…
    const figures = collectFigures(merged.pages[0]!.nodes);
    expect(figures[0]!.figure.alternativeText).toBe('屋上菜園の写真');
    expect(figures[0]!.figure.alternativeTextSource).toBe('generated');
    // …and page 2 is still the page OCR read.
    expect(merged.pages[1]!.origin).toBe('ocr');
    expect(merged.pages[1]!.status).toBe('available');
    expect(merged.pages[1]!.nodes).toHaveLength(1);
  });

  it('refuses to describe a figure that is no longer the one it looked at', () => {
    const live = twoPages([figure({ region: other })], []);
    const result = twoPages([described], []);

    const merged = mergeDescriptions(live, result);

    // Same page, same index, different picture — the description would be a
    // statement about an image nobody sent to the model.
    expect(collectFigures(merged.pages[0]!.nodes)[0]!.figure.alternativeText).toBeUndefined();
    expect(merged).toBe(live);
  });

  it('never overwrites the author’s own alternative text', () => {
    const live = twoPages(
      [figure({ region, alternativeText: '作成者の説明', alternativeTextSource: 'author', status: 'available' })],
      [],
    );

    const merged = mergeDescriptions(live, twoPages([described], []));

    const kept = collectFigures(merged.pages[0]!.nodes)[0]!.figure;
    expect(kept.alternativeText).toBe('作成者の説明');
    expect(kept.alternativeTextSource).toBe('author');
  });

  it('replaces a word processor’s alternative text, which is not the author’s', () => {
    const live = twoPages(
      [
        figure({
          region,
          alternativeText: 'タイムラインが含まれている画像',
          alternativeTextSource: 'document-ai',
          status: 'available',
        }),
      ],
      [],
    );

    const merged = mergeDescriptions(live, twoPages([described], []));

    const updated = collectFigures(merged.pages[0]!.nodes)[0]!.figure;
    expect(updated.alternativeText).toBe('屋上菜園の写真');
    expect(updated.alternativeTextSource).toBe('generated');
  });

  it('carries a failed attempt, so the Reader can say one was made', () => {
    const live = twoPages([figure({ region })], []);
    const attempted = figure({ region, descriptionAttempted: true });

    const merged = mergeDescriptions(live, twoPages([attempted], []));

    const updated = collectFigures(merged.pages[0]!.nodes)[0]!.figure;
    expect(updated.descriptionAttempted).toBe(true);
    expect(updated.alternativeText).toBeUndefined();
  });

  it('leaves the document alone when the run described nothing', () => {
    const live = twoPages([figure({ region })], []);
    expect(mergeDescriptions(live, twoPages([figure({ region })], []))).toBe(live);
  });
});
