import type { PDFDocumentProxy } from 'pdfjs-dist';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * OCR arrives one page at a time.
 *
 * The regression this guards is invisible from the outside: rendering every
 * page first and returning one result at the end produces exactly the same
 * document, and only differs in *when* the reader can see any of it. On a
 * 29-page scan that difference is minutes of unchanged screen, and a failure
 * part-way through used to discard every page already read.
 *
 * Rasterising needs a real canvas and a real PDF.js page, neither of which
 * these tests are about, so the renderer is stubbed and records when it ran.
 */
const events = vi.hoisted(() => [] as string[]);

vi.mock('../lib/pdf/pdfjs/page-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/pdf/pdfjs/page-image')>()),
  renderPageToImage: vi.fn(
    async (_pdf: unknown, pageNumber: number, options: { signal?: AbortSignal } = {}) => {
      // The real renderer cancels its render task on abort, which rejects.
      if (options.signal?.aborted) throw new Error('Rendering cancelled');
      events.push(`render ${pageNumber}`);
      return {
        pageNumber,
        blob: new Blob([`page ${pageNumber}`], { type: 'image/png' }),
        width: 768,
        height: 1086,
        mimeType: 'image/png',
      };
    },
  ),
}));

import type { AccessibleDocument } from '../lib/pdf/document-model';
import { documentToPlainText } from '../lib/pdf/document-model';
import { renderPageToImage } from '../lib/pdf/pdfjs/page-image';
import type { OcrBlock, OcrInput, OcrOptions, OcrProvider, OcrResult } from '../lib/pdf/ocr/provider';
import { runOcrForPages } from '../lib/pdf/ocr/run-ocr';
import { ja } from '../lib/i18n/ja';
import { ocrStatusMessage } from '../lib/reader/components/OcrPanel';

/** Japanese, which is what these assertions were written against. The helper
 * takes its messages so the same wording can be checked in either locale. */
const status = (run: Parameters<typeof ocrStatusMessage>[1]) => ocrStatusMessage(ja, run);

/** A provider that records when each page reached it, and can be told to fail
 * on one of them or to interfere mid-run. */
class RecordingProvider implements OcrProvider {
  readonly id = 'recording';
  readonly displayName = 'Recording OCR (test only)';
  readonly sendsDataExternally = false;
  readonly experimental = true;

  constructor(private readonly onPage: (pageNumber: number) => void = () => {}) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async analyze(input: OcrInput, options: OcrOptions = {}): Promise<OcrResult> {
    const pages: OcrResult['pages'] = [];
    for (const page of input.pages) {
      if (options.signal?.aborted) break;
      events.push(`read ${page.pageNumber}`);
      this.onPage(page.pageNumber);
      const blocks: OcrBlock[] = [{ type: 'paragraph', text: `ページ${page.pageNumber}の本文` }];
      pages.push({ pageNumber: page.pageNumber, blocks });
    }
    return { providerId: this.id, pages };
  }
}

const pdf = {} as PDFDocumentProxy;

beforeEach(() => {
  events.length = 0;
  vi.mocked(renderPageToImage).mockClear();
});

describe('OCR over several pages', () => {
  it('reads each page before rendering the next one', async () => {
    const emitted: AccessibleDocument[] = [];

    const result = await runOcrForPages({
      provider: new RecordingProvider(),
      pdf,
      pageNumbers: [1, 2, 3],
      pageCount: 3,
      onPageResolved: (document) => emitted.push(document),
    });

    // Not "render 1, render 2, render 3, read 1, …": one page's image exists at
    // a time, and its text is handed over before the next page is touched.
    expect(events).toEqual([
      'render 1',
      'read 1',
      'render 2',
      'read 2',
      'render 3',
      'read 3',
    ]);
    expect(result.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
  });

  it('hands the caller every page read so far, as each one lands', async () => {
    const emitted: AccessibleDocument[] = [];

    await runOcrForPages({
      provider: new RecordingProvider(),
      pdf,
      pageNumbers: [1, 2, 3],
      pageCount: 3,
      onPageResolved: (document) => emitted.push(document),
    });

    // One document per page, each carrying everything read up to that point —
    // so the caller merges a partial run exactly as it merges a finished one.
    expect(emitted.map((document) => document.pages.map((page) => page.pageNumber))).toEqual([
      [1],
      [1, 2],
      [1, 2, 3],
    ]);
    expect(documentToPlainText(emitted[0]!)).toContain('ページ1の本文');
  });

  it('keeps the pages already read when a later page fails', async () => {
    const emitted: AccessibleDocument[] = [];
    const provider = new RecordingProvider((pageNumber) => {
      if (pageNumber === 2) throw new Error('engine exploded');
    });

    await expect(
      runOcrForPages({
        provider,
        pdf,
        pageNumbers: [1, 2, 3],
        pageCount: 3,
        onPageResolved: (document) => emitted.push(document),
      }),
    ).rejects.toThrow('engine exploded');

    // The failure is reported, but page 1 is already with the caller and on
    // screen. Before this it was thrown away with the rest of the run.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.pages.map((page) => page.pageNumber)).toEqual([1]);
    expect(vi.mocked(renderPageToImage)).toHaveBeenCalledTimes(2);
  });

  it('stops after the page in flight when the run is aborted', async () => {
    const controller = new AbortController();
    const provider = new RecordingProvider((pageNumber) => {
      if (pageNumber === 2) controller.abort();
    });

    const result = await runOcrForPages({
      provider,
      pdf,
      pageNumbers: [1, 2, 3, 4],
      pageCount: 4,
      ocrOptions: { signal: controller.signal },
    });

    // Page 3 is never rendered, and the two pages that were read come back —
    // stopping a long run costs the reader nothing it had already got.
    expect(result.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(vi.mocked(renderPageToImage)).toHaveBeenCalledTimes(2);
  });
});

/**
 * What the panel says when a run does not read everything.
 *
 * The distinction being pinned: a page that was read and produced nothing, a
 * page the engine gave up on, and a page the run never reached are three
 * different things, and only the first two can honestly be called
 * "could not be read". Stopping a 29-page run after three used to be the
 * sort of place a tool says "26 pages could not be read" about pages nothing
 * ever looked at.
 */
describe('what a partial run reports', () => {
  it('reports a finished run by what it read and what it could not', () => {
    expect(
      status({
        phase: 'done',
        requested: [3, 4, 5],
        attempted: [3, 4, 5],
        read: [3, 5],
        stopped: false,
      }),
    ).toBe('3, 5 ページを読み取りました。1 ページは読み取れませんでした。');
  });

  it('never calls an unread page unreadable when the run was stopped', () => {
    const message = status({
      phase: 'done',
      requested: [1, 2, 3, 4, 5],
      // Page 3 was in flight when the user stopped: a result came back for it,
      // empty. It is not evidence the page is unreadable.
      attempted: [1, 2, 3],
      read: [1, 2],
      stopped: true,
    });

    expect(message).toBe('1, 2 ページを読み取った時点で中止しました。残り 3 ページは読み取っていません。');
    expect(message).not.toContain('読み取れませんでした');
  });

  it('says plainly when a stopped run read nothing', () => {
    expect(
      status({
        phase: 'done',
        requested: [1, 2, 3],
        attempted: [1],
        read: [],
        stopped: true,
      }),
    ).toBe('読み取りを中止しました。読み取れたページはありません。残り 3 ページは読み取っていません。');
  });

  it('says a page was analysed but yielded nothing, rather than that it is blank', () => {
    expect(
      status({
        phase: 'done',
        requested: [7],
        attempted: [7],
        read: [],
        stopped: false,
      }),
    ).toBe('1 ページを解析しましたが、文字を読み取れませんでした。');
  });
});
