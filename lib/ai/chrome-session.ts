import {
  resolveOutputLanguage,
  type SupportedOutputLanguage,
} from '../pdf/describe/output-language';

/**
 * One place that knows how to talk to Chrome's built-in model.
 *
 * Two features use it — figure description and OCR — and before this they each
 * hand-rolled the same six steps: feature-detect the global, probe
 * `availability()`, create a session with the right `expectedInputs` and
 * `expectedOutputs`, clone it per item, destroy the clone, dispose the session.
 *
 * That duplication was not theoretical. **The same bug was shipped twice**:
 * omitting `expectedOutputs`, which makes Chrome log
 *
 *   "No output language was specified in a LanguageModel API request. An output
 *    language should be specified to ensure optimal output quality and properly
 *    attest to output safety."
 *
 * — first on `create()`, then again on `availability()`, because the probe has
 * to describe the very session it is probing for. Two call sites meant two
 * chances to forget. There is now one, and the options are not optional here.
 *
 * The class deliberately does *not* know what a figure or a page is. It owns
 * session lifetime and nothing else; what to ask the model is the caller's.
 */
export interface ChromeSessionConfig {
  /** The system prompt that defines the task. */
  systemPrompt: string;
  /** True when the session will be sent images. Availability differs between a
   * text-only and a multimodal session, so this has to be declared up front. */
  multimodal?: boolean;
}

export type ChromeAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

/**
 * The square the built-in model resizes every image input to.
 *
 * Not in Chrome's documentation — the number comes from the browser's own
 * console warnings, which are explicit about both halves of what it does:
 *
 *   Image input (2480x3508) will be downscaled to 768x768. Dense spatial
 *   details like small text may be lost.
 *   Image input will be stretched from 4.21:1 to a square aspect ratio.
 *
 * So anything sent larger than this is rendered, encoded and handed over only
 * to be thrown away. A 300 DPI A4 page is 8.7 megapixels; the model reads 0.59
 * of them. Capping the render at this edge costs no detail the model would have
 * seen, and saves the rest.
 *
 * The stretch is not addressed here. Feeding it a padded square would preserve
 * the proportions and cost resolution instead, and which of the two the model
 * reads better is not something this project can measure — so the geometry it
 * gets is left exactly as it is today.
 */
export const MODEL_IMAGE_EDGE = 768;

export class ChromeAiSession {
  private session: LanguageModelSession | null = null;
  /** A session is built for one output language; another needs a new one. */
  private language: SupportedOutputLanguage | null = null;

  constructor(private readonly config: ChromeSessionConfig) {}

  /** True when the API exists at all. Every other method assumes it might not. */
  static get supported(): boolean {
    return typeof LanguageModel !== 'undefined';
  }

  /**
   * Can the model serve this request right now?
   *
   * The probe describes the same configuration `open()` would create, because
   * availability is per-configuration — a text-only answer says nothing about a
   * multimodal session.
   */
  async availability(language: string | undefined): Promise<ChromeAvailability> {
    if (typeof LanguageModel === 'undefined') return 'unavailable';
    try {
      return await LanguageModel.availability(this.describe(language));
    } catch {
      return 'unavailable';
    }
  }

  /**
   * Creates the session, downloading the model if the user has none.
   *
   * `onDownloadProgress` exists because that download is measured in gigabytes;
   * a silent multi-minute wait is indistinguishable from a hang.
   */
  async open(options: {
    language?: string;
    signal?: AbortSignal;
    onDownloadProgress?: (loaded: number) => void;
  } = {}): Promise<LanguageModelSession> {
    if (typeof LanguageModel === 'undefined') {
      throw new Error(UNSUPPORTED_BROWSER);
    }

    const language = resolveOutputLanguage(options.language);
    if (this.session && this.language === language) return this.session;

    this.session?.destroy();
    this.session = await LanguageModel.create({
      ...this.describe(options.language),
      initialPrompts: [{ role: 'system', content: this.config.systemPrompt }],
      ...(options.signal ? { signal: options.signal } : {}),
      monitor: (monitor) => {
        monitor.addEventListener('downloadprogress', (event) => {
          options.onDownloadProgress?.(event.loaded);
        });
      },
    });
    this.language = language;
    return this.session;
  }

  /**
   * Runs one prompt on a session of its own.
   *
   * A clone per item, because sessions accumulate context and one figure's
   * description must not be shaped by the previous figure's, nor one page's
   * transcript by the page before it. Cloning is an optimisation though: where
   * it is unavailable, running on the shared session beats failing the item.
   */
  async promptOnce(
    content: LanguageModelContent[],
    options: { language?: string; signal?: AbortSignal } = {},
  ): Promise<string> {
    const base = await this.open({
      ...(options.language !== undefined ? { language: options.language } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    let session = base;
    let cloned = false;
    try {
      session = await base.clone(options.signal ? { signal: options.signal } : undefined);
      cloned = true;
    } catch {
      session = base;
    }

    try {
      return await session.prompt(
        [{ role: 'user', content }],
        options.signal ? { signal: options.signal } : undefined,
      );
    } finally {
      // Only a clone is ours to destroy; tearing down the shared session would
      // break every item after this one.
      if (cloned) session.destroy();
    }
  }

  close(): void {
    this.session?.destroy();
    this.session = null;
    this.language = null;
  }

  /**
   * The configuration, in the exact shape both `availability()` and `create()`
   * take. Sharing it is the whole point: a probe that describes a different
   * session than the one created answers the wrong question, and an output
   * language missing from either is a malformed request.
   */
  private describe(language: string | undefined) {
    return {
      ...(this.config.multimodal ? { expectedInputs: [{ type: 'image' as const }] } : {}),
      expectedOutputs: [
        { type: 'text' as const, languages: [resolveOutputLanguage(language)] },
      ],
    };
  }
}

/**
 * Why the model cannot be used — for a thrown error and a console line, not
 * for a panel.
 *
 * The Reader says this in its own language, from `settings.modelUnavailable*`;
 * what a provider hands back is the *key* that chooses between them
 * (`DescriberAvailability`). These two exist so an exception still reads as a
 * sentence, and they are shared so the two features cannot drift into
 * describing the same hardware bar differently.
 */
export const UNSUPPORTED_BROWSER =
  "This browser does not support Chrome's built-in AI. Desktop Chrome is required.";

export const INSUFFICIENT_HARDWARE =
  "Chrome's built-in AI cannot run on this device. It needs 22 GB of free storage and either 16 GB of memory or 4 GB of VRAM.";
