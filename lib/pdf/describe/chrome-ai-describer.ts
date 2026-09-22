import { ChromeAiSession, MODEL_IMAGE_EDGE } from '../../ai/chrome-session';
import { resolveOutputLanguage, type SupportedOutputLanguage } from './output-language';
import type {
  DescribeOptions,
  DescribedFigure,
  DescriberAvailability,
  FigureDescriber,
  FigureImage,
} from './provider';

/**
 * Figure descriptions from Chrome's built-in model (Gemini Nano), on device.
 *
 * Nothing leaves the machine, so `sendsDataExternally` is false and there is no
 * consent gate, no API key, and no account — which is why this fits the
 * project's privacy model where a hosted vision service would not.
 *
 * The cost is availability: Chrome on desktop only, with roughly 22 GB free
 * storage and either 16 GB of RAM or 4 GB of VRAM. Most users will not have it,
 * so this must never be load-bearing — `isAvailable()` is the gate and the
 * Reader falls back to the honest placeholder.
 *
 * One more constraint shapes the code: **the Prompt API is not available in Web
 * Workers.** Everywhere else in this project the expensive work was pushed off
 * the main thread precisely so the UI and its live region keep responding. Here
 * that is not an option, so descriptions are produced one figure at a time with
 * a yield between them, and progress is reported as they land.
 *
 * Session plumbing lives in `lib/ai/chrome-session.ts`, shared with the OCR
 * provider. This file is only about what to ask, and what to make of the reply.
 */

/** Answering with this exact token is how the model reports "nothing to say". */
const DECORATIVE_TOKEN = 'DECORATIVE';

const SYSTEM_PROMPT = `You write alternative text for images taken from PDF documents, for people using screen readers.

Your default is to describe. Almost every image in a document is worth describing.

Rules:
- Describe only what is visibly present. Never guess at meaning, intent, brand, identity, or anything outside the frame.
- If the image contains text, report that text rather than describing its appearance.
- One or two sentences. No preamble, no "this image shows".
- If you cannot tell what the image is, say that plainly. Do not invent a description, and do not call it decorative.
- Reply with exactly ${DECORATIVE_TOKEN} ONLY for an image with no subject at all: a plain horizontal rule, a solid colour block, a border, or a gradient. A photograph, a logo, an illustration, an icon, a chart, a screenshot, or anything containing text, people, or recognisable objects is NEVER ${DECORATIVE_TOKEN}.`;

export class ChromeAiFigureDescriber implements FigureDescriber {
  readonly id = 'chrome-ai';
  readonly displayName = "Chrome's built-in AI (on-device, experimental)";
  readonly sendsDataExternally = false;
  readonly experimental = true;
  readonly preferredImage = { maxEdge: MODEL_IMAGE_EDGE };

  // Session lifetime, availability probing and clone-per-figure all live in
  // `ChromeAiSession`. What is left here is the part that is actually about
  // describing a picture.
  private readonly ai = new ChromeAiSession({
    systemPrompt: SYSTEM_PROMPT,
    multimodal: true,
  });

  async isAvailable(options: { language?: string } = {}): Promise<DescriberAvailability> {
    if (!ChromeAiSession.supported) {
      return { status: 'unavailable', reason: 'unsupported-browser' };
    }

    switch (await this.ai.availability(options.language)) {
      case 'available':
        return { status: 'available' };
      case 'downloadable':
        return { status: 'downloadable' };
      case 'downloading':
        return { status: 'downloading' };
      default:
        return { status: 'unavailable', reason: 'insufficient-hardware' };
    }
  }

  async prepare(options: {
    language?: string;
    signal?: AbortSignal;
    onDownloadProgress?: (loaded: number) => void;
  } = {}): Promise<void> {
    if (!ChromeAiSession.supported) return;
    await this.ai.open(options);
  }

  async describe(input: FigureImage, options: DescribeOptions = {}): Promise<DescribedFigure> {
    const language = resolveOutputLanguage(input.language);

    const reply = await this.ai.promptOnce(
      [
        { type: 'text', value: buildInstruction(input, language, options.maxLength ?? 200) },
        { type: 'image', value: input.image },
      ],
      {
        ...(input.language !== undefined ? { language: input.language } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );

    return interpret(reply, this.id);
  }

  async dispose(): Promise<void> {
    this.ai.close();
  }
}

function buildInstruction(
  input: FigureImage,
  language: SupportedOutputLanguage,
  maxLength: number,
): string {
  // The instruction names the same language the session declared; asking for
  // one language while declaring another gives the model contradictory
  // requirements.
  const parts = [
    `Write alternative text for this image, in at most ${maxLength} characters.`,
    `Write it in the language with BCP-47 tag "${language}".`,
  ];
  if (input.caption?.trim()) {
    // The caption is context, not something to repeat — a screen reader already
    // reads the <figcaption>.
    parts.push(
      `The document captions this image as "${input.caption.trim()}". Use that only as context; do not repeat it back.`,
    );
  }

  return parts.join(' ');
}

/** Turns the raw reply into a result, catching the two ways it can be useless:
 * the decorative token, and an empty or whitespace answer. */
export function interpret(reply: string, providerId: string): DescribedFigure {
  const text = reply.trim();

  if (text === '') {
    return { description: null, decorative: false, providerId, rawReply: reply };
  }
  if (text.toUpperCase().startsWith(DECORATIVE_TOKEN)) {
    return { description: null, decorative: true, providerId };
  }

  // Models sometimes wrap the answer in quotes or lead with a label despite
  // being told not to; strip those rather than reading them aloud.
  const cleaned = text
    .replace(/^\s*(alt(ernative)?\s*text|代替テキスト)\s*[:：]\s*/i, '')
    .replace(/^["'“”「『]+|["'“”」』]+$/g, '')
    .trim();

  return {
    description: cleaned === '' ? null : cleaned,
    decorative: false,
    providerId,
    // Kept even on success: it is the only way to check what the model was
    // actually asked and answered.
    rawReply: reply,
  };
}
