import type {
  OcrBlock,
  OcrInput,
  OcrOptions,
  OcrPageResult,
  OcrProvider,
  OcrResult,
} from './provider';

/**
 * A provider that recognises nothing and says so.
 *
 * It exists so the whole OCR path — page selection, PDF.js rasterisation,
 * provider dispatch, the adapter, and the Reader's rendering of OCR-derived
 * pages — can be exercised and tested without shipping a recognition engine.
 * It is never offered to end users.
 *
 * It emits structured blocks rather than a string on purpose: that is what
 * keeps the OcrBlock union honest as more capable providers arrive.
 */
export class MockOcrProvider implements OcrProvider {
  readonly id = 'mock';
  readonly displayName = 'Mock OCR (development only)';
  readonly sendsDataExternally = false;
  readonly experimental = true;

  constructor(
    private readonly blocksForPage: (pageNumber: number) => OcrBlock[] = defaultBlocks,
  ) {}

  async isAvailable(): Promise<boolean> {
    return import.meta.env?.MODE !== 'production';
  }

  async analyze(input: OcrInput, options: OcrOptions = {}): Promise<OcrResult> {
    const pages: OcrPageResult[] = [];

    for (const page of input.pages) {
      if (options.signal?.aborted) break;
      options.onProgress?.({ pageNumber: page.pageNumber, ratio: 1 });
      pages.push({
        pageNumber: page.pageNumber,
        blocks: this.blocksForPage(page.pageNumber),
        confidence: 0,
      });
    }

    return { providerId: this.id, pages };
  }
}

function defaultBlocks(pageNumber: number): OcrBlock[] {
  return [
    {
      type: 'paragraph',
      text: `[Mock OCR] Received the image for page ${pageNumber}. No text recognition was performed.`,
    },
  ];
}
