import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withoutControlCharacters } from '../lib/pdf/control-characters';
import { MarkdownView } from '../lib/reader/components/MarkdownView';
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
  it('removes NUL and the other controls that stand for nothing', () => {
    expect(withoutControlCharacters('logo\u0000')).toBe('logo');
    expect(withoutControlCharacters('a\u0001b\u001Fc\u007Fd\u0085e\u009Ff')).toBe('abcdef');
  });

  it('turns vertical tab and form feed into spaces, because they separate words', () => {
    expect(withoutControlCharacters('one\u000Btwo\u000Cthree')).toBe('one two three');
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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
  });
});
