import { act } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the settings say on Firefox for Android (#70).
 *
 * Three things the desktop wording asserts are not true there: that settings
 * sync between devices, that the browser zooms with Ctrl and +, and that the
 * extension has a toolbar button. The browser is swapped out as in
 * `pdf-handler.test.ts`, so `runtime.getPlatformInfo()` can say which it is.
 */
const stub = vi.hoisted(() => ({ browser: undefined as unknown }));
vi.mock('wxt/browser', () => ({
  get browser() {
    return stub.browser;
  },
}));

import { SettingsPanel } from '../lib/reader/components/SettingsPanel';
import { ErrorNotice } from '../lib/reader/components/Notices';
import { PdfError, type PdfErrorMessage } from '../lib/pdf/errors';
import { createRoot } from '../lib/reader/create-root';
import { DEFAULT_SETTINGS } from '../lib/reader/settings';
import { forgetPlatform, guessAndroidFromUserAgent, isAndroid } from '../lib/browser/platform';
import { inLocale } from './helpers/messages';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function onPlatform(os: string): void {
  stub.browser = {
    runtime: { getPlatformInfo: async () => ({ os }) },
    // Enough of the redirect's APIs for "Opening PDFs" to be offered.
    declarativeNetRequest: { updateDynamicRules: async () => {}, getDynamicRules: async () => [] },
    permissions: { request: async () => false, contains: async () => false },
  };
}

afterEach(() => {
  stub.browser = undefined;
  forgetPlatform();
});

describe('isAndroid', () => {
  it('takes the extension runtime’s answer', async () => {
    onPlatform('android');
    expect(await isAndroid()).toBe(true);
    forgetPlatform();
    onPlatform('win');
    expect(await isAndroid()).toBe(false);
  });

  it('falls back to the user agent outside an extension', () => {
    expect(
      guessAndroidFromUserAgent('Mozilla/5.0 (Android 16; Mobile; rv:150.0) Gecko/150.0 Firefox/150.0'),
    ).toBe(true);
    expect(
      guessAndroidFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0'),
    ).toBe(false);
  });
});

describe('the settings panel', () => {
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

  async function mount(locale: 'en' | 'ja'): Promise<string> {
    await act(async () => {
      root.render(
        inLocale(
          locale,
          <SettingsPanel settings={DEFAULT_SETTINGS} onChange={() => {}} onReset={() => {}} />,
        ),
      );
    });
    // The platform's answer arrives after the first render.
    await act(async () => {
      await isAndroid();
    });
    return container.textContent ?? '';
  }

  it('on Android, says settings are not synced and names no Ctrl', async () => {
    onPlatform('android');
    const ja = await mount('ja');
    expect(ja).toContain('他の端末には同期されません');
    expect(ja).not.toContain('Ctrl');
    expect(ja).not.toContain('他の端末にも同期されます');

    // Opening PDFs: tapped, not clicked, and the menu rather than a toolbar.
    expect(ja).toContain('タップした PDF');
    expect(ja).not.toContain('クリック');
    expect(ja).toContain('「拡張機能」から選んだとき');

    const en = await mount('en');
    expect(en).toContain('does not sync them');
    expect(en).toContain('a PDF you tap');
    expect(en).not.toContain('Ctrl');
  });

  it('on the desktop, keeps the desktop wording', async () => {
    onPlatform('win');
    const ja = await mount('ja');
    expect(ja).toContain('他の端末にも同期されます');
    expect(ja).toContain('Ctrl');
    expect(ja).toContain('クリックした PDF');
  });
});

describe('the error messages', () => {
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

  async function mount(key: PdfErrorMessage, locale: 'en' | 'ja'): Promise<string> {
    await act(async () => {
      root.render(inLocale(locale, <ErrorNotice error={new PdfError('no-source', key)} />));
    });
    await act(async () => {
      await isAndroid();
    });
    return container.textContent ?? '';
  }

  /** No toolbar button and no Chrome setting on Android: the menu, and the file. */
  it('on Android, name the browser’s menu and not a toolbar or Chrome', async () => {
    onPlatform('android');
    const noSource = await mount('no-source', 'ja');
    expect(noSource).toContain('「拡張機能」');
    expect(noSource).not.toContain('ツールバー');

    const fileScheme = await mount('file-scheme', 'ja');
    expect(fileScheme).not.toContain('Chrome');
    expect(fileScheme).toContain('ファイルを選んで');

    const english = await mount('no-source', 'en');
    expect(english).toContain('under Extensions');
    expect(english).not.toContain('toolbar');
  });

  it('on the desktop, keep the desktop wording', async () => {
    onPlatform('win');
    expect(await mount('no-source', 'ja')).toContain('ツールバー');
    expect(await mount('file-scheme', 'en')).toContain('Chrome');
  });
});
