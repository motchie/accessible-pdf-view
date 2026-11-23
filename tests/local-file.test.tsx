import { act } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfError } from '../lib/pdf/errors';
import { UrlPdfSource } from '../lib/pdf/source/url-pdf-source';
import {
  LocalFileChooser,
  isAnsweredByAFile,
  type ChosenFile,
} from '../lib/reader/components/LocalFileChooser';
import { ErrorNotice } from '../lib/reader/components/Notices';
import { createRoot } from '../lib/reader/create-root';
import { inLocale } from './helpers/messages';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A PDF on the device (#69).
 *
 * Firefox for Android opens a downloaded PDF at a `content:` address. The
 * Reader used to fetch it, fail, and blame the network and a missing site
 * permission — neither of which was the case. Now the address is recognised
 * before anything is fetched, and the file can be chosen instead.
 */
describe('a content: address', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is said to be a file on the device, without trying to fetch it', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    const failure = await new UrlPdfSource('content://media/external/downloads/1234')
      .getBytes()
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PdfError);
    expect((failure as PdfError).messageKey).toBe('content-scheme');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is one of the errors a chosen file answers; a refused fetch is not', () => {
    for (const key of ['content-scheme', 'file-scheme', 'blob-scheme', 'no-source'] as const) {
      expect(isAnsweredByAFile(key), key).toBe(true);
    }
    expect(isAnsweredByAFile('fetch-failed')).toBe(false);
    expect(isAnsweredByAFile('parse-failed')).toBe(false);
  });
});

describe('choosing a file', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function mountNotice(locale: 'en' | 'ja', onChoose: (file: ChosenFile) => void = () => {}) {
    act(() => {
      root.render(
        inLocale(
          locale,
          <ErrorNotice error={new PdfError('unsupported-scheme', 'content-scheme')}>
            <LocalFileChooser onChoose={onChoose} />
          </ErrorNotice>,
        ),
      );
    });
  }

  it('says what is true, not that the network failed', () => {
    mountNotice('ja');
    const text = container.textContent ?? '';
    expect(text).toContain('端末内のファイル');
    expect(text).not.toContain('ネットワーク');

    mountNotice('en');
    const english = container.textContent ?? '';
    expect(english).toContain('file on this device');
    expect(english).not.toContain('network');
  });

  /**
   * A native input with a visible label and the privacy hint as its
   * description: the label is what a screen reader announces on reaching it.
   */
  it('is a labelled file input that accepts PDFs', () => {
    mountNotice('ja');
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const label = container.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`);

    expect(label?.textContent).toBe('PDF ファイルを選ぶ');
    expect(input.accept).toContain('application/pdf');
    const hint = document.getElementById(input.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toContain('どこにも送信されません');
  });

  it('hands over the chosen file’s name and bytes', async () => {
    const chosen: ChosenFile[] = [];
    mountNotice('en', (file) => chosen.push(file));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    const bytes = new TextEncoder().encode('%PDF-1.7\n');
    const file = new File([bytes], 'report.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(() => expect(chosen).toHaveLength(1));

    expect(chosen[0]!.name).toBe('report.pdf');
    expect([...new Uint8Array(chosen[0]!.bytes)]).toEqual([...bytes]);
  });
});
