/**
 * Control characters, which text read from a PDF can carry but which are not
 * text: C0 except tab, line feed and carriage return, and DEL.
 *
 * Vertical tab and form feed become spaces, because they separate words: Word
 * writes U+000B for a manual line break. A space, not a line break, because
 * the same text can be a single line — an `/Alt`, a Markdown heading — where a
 * break would change what it is. Neither character was found in any reading,
 * or in pdf-inspector's raw Markdown, of the 17 PDFs measured (2026-11-21).
 *
 * The rest are removed. A 91-page export from Word for Microsoft 365 ends both
 * of its logos' `/Alt` strings with a NUL byte, in the file itself, not added
 * in decoding. Left in, it reached the Markdown, and a paste through the
 * Windows clipboard, which takes NUL as the end of the text, stopped there:
 * inside line 5 of 2,180.
 *
 * C1 (U+0080 to U+009F) is left alone. Nothing there is known to cut a paste,
 * and it can be text that was decoded wrongly rather than no text: a font read
 * as Latin-1 that is really Windows-1252 gives U+0085 for an ellipsis,
 * U+0093 and U+0094 for quotation marks, U+0096 and U+0097 for dashes. Of the
 * 17 PDFs measured, one has C1: a Japanese letter whose list bullets are a
 * symbol-font glyph that pdf-inspector reads as U+0097 (pdftotext reads
 * U+F097, and the tagged reading has a list item there).
 */
const WORD_SEPARATORS = /[\u000B\u000C]/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000E-\u001F\u007F]/g;

export function withoutControlCharacters(text: string): string {
  return text.replace(WORD_SEPARATORS, ' ').replace(CONTROL_CHARACTERS, '');
}
