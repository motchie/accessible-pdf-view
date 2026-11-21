/**
 * Control characters, which text read from a PDF can carry but which are not
 * text: C0 except tab, line feed and carriage return, DEL, and C1.
 *
 * Vertical tab and form feed become spaces, because they separate words: Word
 * writes U+000B for a manual line break. The rest are removed, because where
 * they have been seen they stood for nothing. A 91-page export from Word for
 * Microsoft 365 ends both of its logos' `/Alt` strings with a NUL byte, in the
 * file itself, not added in decoding. Left in, it reached the Markdown, and a
 * paste through the Windows clipboard, which takes NUL as the end of the text,
 * stopped there: inside line 5 of 2,180. Other producers have not been
 * measured.
 */
const WORD_SEPARATORS = /[\u000B\u000C]/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g;

export function withoutControlCharacters(text: string): string {
  return text.replace(WORD_SEPARATORS, ' ').replace(CONTROL_CHARACTERS, '');
}
