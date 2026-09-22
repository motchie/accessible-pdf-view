/**
 * Chrome's built-in AI APIs (Gemini Nano), as much of them as this project uses.
 *
 * These are browser globals with no npm type package, and they exist only in
 * Chrome on a desktop that meets the hardware bar. Everything here is declared
 * optional on `globalThis` so that a feature check is required before use and
 * every other browser type-checks fine.
 *
 * Reference: https://developer.chrome.com/docs/ai/prompt-api
 */

declare global {
  /** Whether the on-device model can serve a request right now. */
  type AiAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

  interface AiCreateMonitor extends EventTarget {
    addEventListener(
      type: 'downloadprogress',
      listener: (event: Event & { loaded: number }) => void,
    ): void;
  }

  /** Multimodal prompt content. Images accept the types Chrome documents,
   * including `Blob` — which is what lib/pdf/pdfjs renders pages and figures to. */
  type LanguageModelContent =
    | { type: 'text'; value: string }
    | { type: 'image'; value: Blob | ImageBitmap | ImageData | OffscreenCanvas }
    | { type: 'audio'; value: Blob | AudioBuffer | ArrayBuffer };

  interface LanguageModelMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | LanguageModelContent[];
  }

  interface LanguageModelCreateOptions {
    initialPrompts?: LanguageModelMessage[];
    /** Declaring image input up front is required for multimodal sessions, and
     * `availability()` reports differently depending on it. */
    expectedInputs?: Array<{ type: 'text' | 'image' | 'audio'; languages?: string[] }>;
    expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
    temperature?: number;
    topK?: number;
    monitor?: (monitor: AiCreateMonitor) => void;
    signal?: AbortSignal;
  }

  interface LanguageModelPromptOptions {
    signal?: AbortSignal;
    /** JSON Schema constraining the reply. */
    responseConstraint?: object;
  }

  interface LanguageModelSession {
    prompt(
      input: string | LanguageModelMessage[],
      options?: LanguageModelPromptOptions,
    ): Promise<string>;
    promptStreaming(
      input: string | LanguageModelMessage[],
      options?: LanguageModelPromptOptions,
    ): ReadableStream<string>;
    append(messages: LanguageModelMessage[]): Promise<void>;
    clone(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>;
    destroy(): void;
    readonly contextWindow: number;
    readonly contextUsage: number;
  }

  interface LanguageModelStatic {
    availability(options?: {
      expectedInputs?: Array<{ type: 'text' | 'image' | 'audio'; languages?: string[] }>;
      /** Required in practice: an availability probe without it triggers the
       * same "No output language was specified" warning as `create()`. */
      expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
    }): Promise<AiAvailability>;
    create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
    /** Chrome Extensions only. */
    params(): Promise<{
      defaultTopK: number;
      maxTopK: number;
      defaultTemperature: number;
      maxTemperature: number;
    } | null>;
  }

  interface LanguageDetectorResult {
    detectedLanguage: string;
    confidence: number;
  }

  interface LanguageDetectorStatic {
    availability(): Promise<AiAvailability>;
    create(options?: {
      monitor?: (monitor: AiCreateMonitor) => void;
      signal?: AbortSignal;
    }): Promise<{
      detect(text: string): Promise<LanguageDetectorResult[]>;
      destroy(): void;
    }>;
  }

  var LanguageModel: LanguageModelStatic | undefined;
  var LanguageDetector: LanguageDetectorStatic | undefined;
}

export {};
