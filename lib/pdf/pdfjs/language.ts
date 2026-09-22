/**
 * Working out what language a document is in, when it does not say.
 *
 * A PDF's `/Lang` is the authoritative answer and the Reader uses it whenever
 * it exists. Plenty of PDFs omit it — pdf-inspector reports no language at all,
 * and an untagged export from a word processor often has none either. Without
 * a `lang` attribute a screen reader falls back to its own default voice, so a
 * Japanese document can be read out with English pronunciation rules. That is
 * not a cosmetic problem; it can make the text unintelligible.
 *
 * Chrome's Language Detector runs on device, so this costs no network request.
 * It is strictly a fallback: a detected language never overrides a declared one.
 */

/** Below this the guess is not worth acting on — a wrong `lang` is worse than
 * none, because the screen reader then commits to the wrong pronunciation. */
const MIN_CONFIDENCE = 0.7;

/** Enough text to judge from. Detection on a handful of words is unreliable. */
const MIN_SAMPLE_LENGTH = 40;
const MAX_SAMPLE_LENGTH = 4000;

/**
 * The last resort before giving up: what writing system is this?
 *
 * Chrome's detector is not always there — it needs its own model download, and
 * `availability()` reports `downloadable` rather than `available` until the user
 * has one. On a document that also declares no `/Lang`, that leaves the Reader
 * with no language at all, and everything downstream falls back to English. A
 * Japanese document then gets described in English, which is what prompted this.
 *
 * Script is a much weaker signal than the detector, so only the cases where it
 * is close to certain are claimed:
 *
 *   - Kana (hiragana or katakana) appears in essentially no language but
 *     Japanese.
 *   - Hangul, likewise, for Korean.
 *
 * Han characters alone are deliberately *not* claimed: they are shared by
 * Chinese, Japanese and Korean, and guessing wrong commits a screen reader to
 * the wrong pronunciation for the whole document — worse than no guess.
 */
const KANA = /[぀-ゟ゠-ヿ]/;
const HANGUL = /[가-힯ᄀ-ᇿ]/;

export function detectScriptLanguage(sample: string): string | null {
  if (KANA.test(sample)) return 'ja';
  if (HANGUL.test(sample)) return 'ko';
  return null;
}

export async function detectLanguage(
  sample: string,
  options: { signal?: AbortSignal } = {},
): Promise<string | null> {
  if (typeof LanguageDetector === 'undefined') return null;

  const text = sample.trim().slice(0, MAX_SAMPLE_LENGTH);
  if (text.length < MIN_SAMPLE_LENGTH) return null;

  try {
    if ((await LanguageDetector.availability()) !== 'available') return null;

    const detector = await LanguageDetector.create(
      options.signal ? { signal: options.signal } : undefined,
    );
    try {
      const results = await detector.detect(text);
      const best = results
        .filter((result) => result.detectedLanguage && result.detectedLanguage !== 'und')
        .sort((a, b) => b.confidence - a.confidence)[0];

      return best && best.confidence >= MIN_CONFIDENCE ? best.detectedLanguage : null;
    } finally {
      detector.destroy();
    }
  } catch {
    // Detection is an optimisation; never let it break loading a document.
    return null;
  }
}
