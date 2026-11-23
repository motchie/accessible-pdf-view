import { act } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where the Reader's Settings button goes (#68).
 *
 * The browser is swapped out the same way as in `pdf-handler.test.ts`: the
 * module is replaced and read through a getter, so each test hands over the
 * browser it is about — desktop with a side panel, Firefox for Android with
 * only an options page, or none at all.
 */
const stub = vi.hoisted(() => ({ browser: undefined as unknown }));
vi.mock('wxt/browser', () => ({
  get browser() {
    return stub.browser;
  },
}));

import { openSettings, settingsSurface } from '../lib/browser/side-panel';
import { ReaderToolbar } from '../lib/reader/components/ReaderToolbar';
import { createRoot } from '../lib/reader/create-root';
import { inLocale } from './helpers/messages';
import { settingsPageTitle } from '../entrypoints/sidepanel/title';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Firefox for Android, as far as this question goes: no sidebar, an options page. */
function android() {
  const openOptionsPage = vi.fn(async () => {});
  stub.browser = { runtime: { openOptionsPage } };
  return openOptionsPage;
}

/** Desktop Firefox: a sidebar, and an options page beside it. */
function desktopFirefox() {
  const sidebarOpen = vi.fn(async () => {});
  const openOptionsPage = vi.fn(async () => {});
  stub.browser = { sidebarAction: { open: sidebarOpen }, runtime: { openOptionsPage } };
  return { sidebarOpen, openOptionsPage };
}

afterEach(() => {
  stub.browser = undefined;
});

describe('settingsSurface', () => {
  it('is the side panel wherever there is one, even with an options page too', () => {
    desktopFirefox();
    expect(settingsSurface()).toBe('side-panel');
  });

  it('is the options page where there is no sidebar', () => {
    android();
    expect(settingsSurface()).toBe('options-page');
  });

  it('is nowhere outside an extension', () => {
    expect(settingsSurface()).toBeNull();
  });
});

describe('openSettings', () => {
  it('opens the sidebar on desktop, not the options page', async () => {
    const { sidebarOpen, openOptionsPage } = desktopFirefox();
    await openSettings();
    expect(sidebarOpen).toHaveBeenCalledOnce();
    expect(openOptionsPage).not.toHaveBeenCalled();
  });

  it('opens the options page where there is no sidebar', async () => {
    const openOptionsPage = android();
    await openSettings();
    expect(openOptionsPage).toHaveBeenCalledOnce();
  });

  it('says so rather than doing nothing where neither exists', async () => {
    await expect(openSettings()).rejects.toThrow();
  });
});

describe('the Settings button', () => {
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

  function mount(locale: 'en' | 'ja'): HTMLButtonElement | null {
    act(() => {
      root.render(
        inLocale(
          locale,
          <ReaderToolbar
            views={[{ id: 'reader', label: 'Reader', description: 'HTML' }]}
            active="reader"
            onChange={() => {}}
            fileName={null}
            sourceUrl={null}
          />,
        ),
      );
    });
    return container.querySelector<HTMLButtonElement>('[data-apv-toolbar-item="settings"]');
  }

  /**
   * Firefox for Android: the button is there, says it opens a new tab — which
   * is where the options page arrives — and opens it.
   */
  it('is offered on Android, and says it opens in a new tab', () => {
    const openOptionsPage = android();
    const button = mount('ja');

    expect(button).not.toBeNull();
    expect(button!.textContent).toContain('新しいタブ');
    expect(button!.textContent).not.toContain('サイドパネル');

    act(() => button!.click());
    expect(openOptionsPage).toHaveBeenCalledOnce();
  });

  it('says it in English too', () => {
    android();
    expect(mount('en')!.textContent).toContain('new tab');
  });

  it('still says side panel on desktop', () => {
    desktopFirefox();
    expect(mount('ja')!.textContent).toContain('サイドパネル');
  });
});

describe('the settings page’s own title', () => {
  /** The options page is a tab (#68), and its title is what the tab list reads. */
  it('follows the interface language', () => {
    expect(settingsPageTitle('ja')).toBe('設定 — Accessible PDF View');
    expect(settingsPageTitle('en')).toBe('Settings — Accessible PDF View');
  });
});
