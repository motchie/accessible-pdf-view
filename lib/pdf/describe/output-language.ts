/**
 * Choosing the output language for a Chrome built-in AI session.
 *
 * The API requires it. Omitting `expectedOutputs` produces:
 *
 *   "No output language was specified in a LanguageModel API request. An output
 *    language should be specified to ensure optimal output quality and properly
 *    attest to output safety."
 *
 * and Chrome supports a fixed, small set. A document in any other language
 * still gets a description — just an English one — which is a limitation worth
 * stating plainly rather than failing over.
 */
export const SUPPORTED_OUTPUT_LANGUAGES = ['de', 'en', 'es', 'fr', 'ja'] as const;

export type SupportedOutputLanguage = (typeof SUPPORTED_OUTPUT_LANGUAGES)[number];

const SUPPORTED = new Set<string>(SUPPORTED_OUTPUT_LANGUAGES);

/**
 * Maps a document's BCP-47 tag onto a language the model can write.
 *
 * Only the primary subtag matters — `ja-JP` and `ja` are the same request as
 * far as this API is concerned. Anything unsupported falls back to English,
 * because a description in the wrong language is still more use than none, and
 * the alternative is refusing to describe the figure at all.
 */
export function resolveOutputLanguage(
  language: string | undefined,
): SupportedOutputLanguage {
  if (!language) return 'en';

  const primary = language.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return SUPPORTED.has(primary) ? (primary as SupportedOutputLanguage) : 'en';
}

/** True when the document's language is one the model can actually write in,
 * so the UI can warn that the description will come back in English. */
export function isOutputLanguageSupported(language: string | undefined): boolean {
  if (!language) return false;
  const primary = language.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return SUPPORTED.has(primary);
}

/** Where the chosen output language came from, so the UI can say so — and so a
 * guess is never presented as the document's own declaration. */
export type OutputLanguageSource =
  /** The reader chose it in the settings, overruling what the document says. */
  | 'setting'
  /** The document says what language it is, or we detected it from the text. */
  | 'document'
  /** The document does not say; the browser's own language was used instead. */
  | 'browser'
  /** Neither was usable, so English. */
  | 'default';

export interface OutputLanguageChoice {
  language: SupportedOutputLanguage;
  source: OutputLanguageSource;
  /** The raw tag this came from, for the UI to show. */
  from?: string;
}

export interface OutputLanguageOptions {
  /**
   * The language the reader asked for, which wins over everything below.
   *
   * `/Lang` is metadata like any other, and documents carry the wrong one: a
   * Japanese report exported with `en` in its catalog is described in English
   * by a model doing exactly as it was told. Nothing inside the file exposes
   * that, because the file is the part that is wrong — so the only thing that
   * can overrule it is a person saying so, which is what this carries.
   */
  preferred?: SupportedOutputLanguage | undefined;
  /** Defaults to the browser's own list. */
  browserLanguages?: readonly string[] | undefined;
}

/**
 * Picks the language a description should be written in.
 *
 * `resolveOutputLanguage` answers "what can the model write, given this tag" and
 * falls back to English when the answer is nothing. That is the right answer for
 * a document that *declares* an unsupported language — but the wrong one for a
 * document that declares nothing, which is extremely common: PDFs from office
 * suites routinely omit `/Lang`, and Chrome's language detector needs its own
 * model download before it can fill the gap.
 *
 * The result was a Japanese document being described in English on a Japanese
 * user's Japanese-language browser. So when the document is silent, the
 * browser's own language is a far better guess than English — the person
 * reading is overwhelmingly likely to want it. The guess is labelled, never
 * silent: `source` tells the UI to say where the language came from.
 *
 * `preferred` sits above all of it, for the case none of this can detect: a
 * document that declares a language confidently and declares the wrong one.
 */
export function chooseOutputLanguage(
  documentLanguage: string | undefined,
  options: OutputLanguageOptions = {},
): OutputLanguageChoice {
  if (options.preferred) {
    return { language: options.preferred, source: 'setting' };
  }

  if (documentLanguage?.trim()) {
    return {
      language: resolveOutputLanguage(documentLanguage),
      source: 'document',
      from: documentLanguage,
    };
  }

  const browserLanguages = options.browserLanguages ?? globalThis.navigator?.languages ?? [];
  for (const candidate of browserLanguages) {
    if (isOutputLanguageSupported(candidate)) {
      return {
        language: resolveOutputLanguage(candidate),
        source: 'browser',
        from: candidate,
      };
    }
  }

  return { language: 'en', source: 'default' };
}

/* The human-readable names for these live in the message catalogue, at
 * `languages`: telling the reader which language a description will be written
 * in is interface text, and has to be in the interface's own language. */
