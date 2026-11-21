/**
 * Control characters, which text read from a PDF can carry but which are not
 * text: C0 except tab, line feed and carriage return, DEL, and C1.
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
 * inside line 5 of 2,180. Removal does lose something once: a Japanese letter
 * whose list bullets are a symbol-font glyph that pdf-inspector reads as U+0097
 * (pdftotext reads U+F097, and the tagged reading has a list item there). The
 * glyph says nothing as U+0097, and the space before it stays.
 */
const WORD_SEPARATORS = /[\u000B\u000C]/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g;

export function withoutControlCharacters(text: string): string {
  return text.replace(WORD_SEPARATORS, ' ').replace(CONTROL_CHARACTERS, '');
}
