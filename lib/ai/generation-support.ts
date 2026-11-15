/**
 * Whether this browser offers an on-device model the extension can generate
 * text with — image descriptions and OCR.
 *
 * The question the interface asks before it offers anything about generated
 * text: the AI-language setting, the note that generated results stay with a
 * reading. Today the only provider is Chrome's built-in `LanguageModel`, so
 * this is that API's presence; a provider for another browser joins here, and
 * every place that asks changes with it.
 *
 * **Presence, not availability.** This says the API exists, not that the model
 * can run: on a Chrome machine without the hardware it is still true, and the
 * settings panel's model section is what says why nothing is generated there.
 * Presence is known synchronously, at the first render, so what depends on it
 * is there or not from the start rather than appearing once a probe answers —
 * and a probe that fails once cannot take anything away.
 *
 * A module of its own, with no imports, so asking does not pull the session
 * code into a page that only needs the answer.
 */
export function canGenerateText(): boolean {
  return typeof LanguageModel !== 'undefined';
}
