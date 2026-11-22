import { act } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from '../lib/reader/create-root';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withoutControlCharacters } from '../lib/pdf/control-characters';
import type { AccessibleDocument, DocumentNode } from '../lib/pdf/document-model';
import { en } from '../lib/i18n/en';
import { ja } from '../lib/i18n/ja';
import { MarkdownView } from '../lib/reader/components/MarkdownView';
import { figurePlaceholderText } from '../lib/reader/renderer';
import { inLocale } from './helpers/messages';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Control characters out of text read from a PDF. A NUL at the end of a Word
 * export's `/Alt` cut a paste of the copied Markdown short, through the Windows
 * clipboard, inside line 5 of 2,180.
 */
describe('withoutControlCharacters', () => {
  it('removes NUL and the other C0 controls, and DEL', () => {
    expect(withoutControlCharacters('logo\u0000')).toBe('logo');
    expect(withoutControlCharacters('a\u0001b\u001Fc\u007Fd')).toBe('abcd');
  });

  it('turns vertical tab and form feed into spaces, because they separate words', () => {
    expect(withoutControlCharacters('one\u000Btwo\u000Cthree')).toBe('one two three');
  });

  it('leaves C1 alone, because it can be punctuation decoded wrongly', () => {
    // U+0085, U+0093 and U+0097 are ellipsis, quotation mark and dash in Windows-1252.
    const text = 'a\u0085b\u0093c\u0097d\u0080\u009F';
    expect(withoutControlCharacters(text)).toBe(text);
  });

  it('leaves tab, line feed, carriage return and ordinary text alone', () => {
    const text = '# 見出し\n\nA\tB\r\n本文 « ok » \u00A0';
    expect(withoutControlCharacters(text)).toBe(text);
  });
});

describe('copying the Markdown', () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeText: ReturnType<typeof vi.fn>;
  // jsdom's own, put back afterwards so no later test sees this mock.
  let ownClipboard: PropertyDescriptor | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    writeText = vi.fn().mockResolvedValue(undefined);
    ownClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (ownClipboard) Object.defineProperty(navigator, 'clipboard', ownClipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('copies the raw source whole, less the NUL that would end a paste', async () => {
    const raw = '# Title\n\n![Logo\u0000](image)\n\nThe rest of the document.';
    act(() => {
      root.render(inLocale('ja', <MarkdownView document={null} rawMarkdown={raw} source="raw" />));
    });

    await act(async () => {
      container.querySelector('button')!.click();
    });

    expect(writeText).toHaveBeenCalledWith('# Title\n\n![Logo](image)\n\nThe rest of the document.');
    // And what is shown is the same text, so a selection copied by hand is
    // whole too.
    expect(container.querySelector('pre')!.textContent).toBe(
      '# Title\n\n![Logo](image)\n\nThe rest of the document.',
    );
  });

  /** The serializer writes the Reader's own words in the UI language, so a
   * change of language has to reach the Markdown without a new document. */
  it('writes the Markdown again when the UI language changes', () => {
    const figure: Extract<DocumentNode, { type: 'figure' }> = {
      type: 'figure',
      status: 'missing-alt',
      altTextFieldRead: true,
    };
    const pdf: AccessibleDocument = {
      metadata: { sourceUrl: null, pageCount: 1, producedBy: ['tagged-pdf'] },
      pages: [{ pageNumber: 1, origin: 'tagged-pdf', status: 'available', nodes: [figure] }],
    };
    const view = (locale: 'ja' | 'en') =>
      inLocale(locale, <MarkdownView document={pdf} rawMarkdown={null} source="document" />);

    act(() => root.render(view('ja')));
    expect(container.querySelector('pre')!.textContent).toContain(figurePlaceholderText(ja, figure));

    act(() => root.render(view('en')));
    const shown = container.querySelector('pre')!.textContent!;
    expect(shown).toContain(figurePlaceholderText(en, figure));
    expect(shown).not.toContain(figurePlaceholderText(ja, figure));
  });
});
