import { ChromeAiSession, MODEL_IMAGE_EDGE } from '../../ai/chrome-session';
import { PdfError } from '../errors';
import type {
  OcrBlock,
  OcrInput,
  OcrOptions,
  OcrPageResult,
  OcrProvider,
  OcrResult,
} from './provider';

/**
 * OCR through Chrome's built-in model, on device.
 *
 * Experimental, and the label is not a formality. Gemini Nano is a small model
 * doing general vision, not a purpose-built OCR engine, and this project's
 * primary target is Japanese — dense vertical text, ruby annotations and poor
 * scans are exactly where a small model degrades, and exactly what drives
 * people to an accessibility tool in the first place. Whether the output is
 * good enough to present as *the document* has to be measured on real scans
 * before this is offered as anything but an experiment.
 *
 * Structurally it is honest about that: every page comes back as a single
 * `paragraph` block. The model is not asked to infer headings or tables, and
 * `OcrBlock`'s richer variants stay unused rather than being filled with
 * guesses. Reading order within a page is the model's, and it is not verified.
 *
 * Like the figure describer, this cannot run in a Web Worker, so pages are
 * processed one at a time with a yield between them.
 */
const SYSTEM_PROMPT = `You transcribe text from scanned document pages.

Rules:
- Output only the text that is visibly present on the page, in reading order.
- Preserve line and paragraph breaks. Do not summarize, translate, or correct.
- Do not add commentary, headings, or markup that is not in the image.
- If the page contains no legible text, reply with exactly EMPTY.`;

const EMPTY_TOKEN = 'EMPTY';

export class ChromeAiOcrProvider implements OcrProvider {
  readonly id = 'chrome-ai';
  readonly displayName = "Chrome's built-in AI OCR (on-device, experimental)";
  readonly sendsDataExternally = false;
  readonly experimental = true;
  /**
   * The built-in model resizes every image to a fixed square, so a 300 DPI page
   * is 8.7 megapixels rendered to be thrown away. This is what it reads.
   */
  readonly preferredImage = { maxEdge: MODEL_IMAGE_EDGE };

  private readonly ai = new ChromeAiSession({
    systemPrompt: SYSTEM_PROMPT,
    multimodal: true,
  });

  async isAvailable(options: { languages?: string[] } = {}): Promise<boolean> {
    return (await this.ai.availability(options.languages?.[0])) === 'available';
  }

  async analyze(input: OcrInput, options: OcrOptions = {}): Promise<OcrResult> {
    if (!ChromeAiSession.supported) {
      throw new PdfError('ocr-failed', 'ocr-unsupported-browser');
    }

    // Transcribed text comes back in the page's own language, so that is the
    // language the session declares.
    const language = options.languages?.[0];
    const pages: OcrPageResult[] = [];

    for (const page of input.pages) {
      if (options.signal?.aborted) break;
      options.onProgress?.({ pageNumber: page.pageNumber, ratio: 0 });

      const image = page.image instanceof Blob ? page.image : new Blob([page.image]);

      try {
        const reply = await this.ai.promptOnce(
          [
            { type: 'text', value: buildInstruction(options.languages) },
            { type: 'image', value: image },
          ],
          {
            ...(language !== undefined ? { language } : {}),
            ...(options.signal ? { signal: options.signal } : {}),
          },
        );
        pages.push({ pageNumber: page.pageNumber, blocks: toBlocks(reply) });
      } catch {
        // A page the model refuses or fails on stays empty; the Reader reports
        // it as still requiring OCR rather than claiming it is blank.
        pages.push({ pageNumber: page.pageNumber, blocks: [] });
      }

      options.onProgress?.({ pageNumber: page.pageNumber, ratio: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return { providerId: this.id, pages };
  }

  async dispose(): Promise<void> {
    this.ai.close();
  }
}

function buildInstruction(languages: string[] | undefined): string {
  const base = 'Transcribe all text visible in this document page image.';
  if (!languages?.length) return base;
  return `${base} The page is expected to be in: ${languages.join(', ')}.`;
}

/**
 * One paragraph per blank-line-separated run. No heading or table inference —
 * see the class comment for why that restraint is deliberate.
 */
export function toBlocks(reply: string): OcrBlock[] {
  const text = reply.trim();
  if (text === '' || text.toUpperCase().startsWith(EMPTY_TOKEN)) return [];

  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .map((paragraph): OcrBlock => ({ type: 'paragraph', text: paragraph }));
}
