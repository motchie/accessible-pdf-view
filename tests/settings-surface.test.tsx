import { act } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../lib/reader/create-root';
import { inLocale } from './helpers/messages';

/**
 * Where the toolbar's Settings button goes (#68): the side panel (Chrome) or
 * sidebar (desktop Firefox) where there is one, else the extension's options
 * page — Firefox for Android has no sidebar. With neither, no button.
 */
const fake = vi.hoisted(() => ({ browser: {} as Record<string, unknown> }));
vi.mock('wxt/browser', () => ({
  get browser() {
    return fake.browser;
  },
}));

// The settings surface reads storage through the extension API; here it only
// has to render.
vi.mock('../lib/reader/use-settings', async () => {
  const { DEFAULT_SETTINGS } = await import('../lib/reader/settings');
  return {
    useReaderSettings: () => ({
      settings: DEFAULT_SETTINGS,
      update: () => {},
      reset: () => {},
      loaded: true,
    }),
    useAppliedSettings: () => {},
  };
});

const { openSettings, returnToReader, returnToTab, settingsSurface } = await import(
  '../lib/browser/side-panel'
);
const { default: SettingsApp } = await import('../entrypoints/sidepanel/App');
const { ReaderToolbar } = await import('../lib/reader/components/ReaderToolbar');

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  fake.browser = {};
});

function mountToolbar(): void {
  act(() =>
    root.render(
      inLocale(
        'ja',
        <ReaderToolbar views={[]} active="reader" onChange={() => {}} fileName={null} sourceUrl={null} />,
      ),
    ),
  );
}

const settingsButton = () =>
  [...container.querySelectorAll('button')].find((button) => button.textContent?.startsWith('設定'));

describe('the settings surface', () => {
  it('is the sidebar where there is one, as on desktop Firefox', async () => {
    const open = vi.fn(async () => {});
    fake.browser = { sidebarAction: { open }, runtime: { openOptionsPage: vi.fn() } };

    expect(settingsSurface()).toBe('side-panel');
    await openSettings();
    expect(open).toHaveBeenCalledOnce();
  });

  it('is the options page where there is no side panel, as on Firefox for Android', async () => {
    const openOptionsPage = vi.fn(async () => {});
    const create = vi.fn(async () => ({}));
    fake.browser = {
      runtime: { openOptionsPage, getURL: (path: string) => `moz-extension://x${path}` },
      tabs: { getCurrent: async () => ({ id: 7 }), create },
    };

    expect(settingsSurface()).toBe('options-page');
    await openSettings();
    // As a tab that knows which Reader tab to go back to.
    expect(create).toHaveBeenCalledWith({ url: 'moz-extension://x/options.html?returnTo=7' });
    expect(openOptionsPage).not.toHaveBeenCalled();
  });

  it('falls back to openOptionsPage when the calling tab is unknown', async () => {
    const openOptionsPage = vi.fn(async () => {});
    fake.browser = { runtime: { openOptionsPage }, tabs: { getCurrent: async () => undefined } };

    await openSettings();
    expect(openOptionsPage).toHaveBeenCalledOnce();
  });

  it('is nowhere without either, and then the toolbar has no Settings button', () => {
    fake.browser = {};
    expect(settingsSurface()).toBeNull();
    mountToolbar();
    expect(settingsButton()).toBeUndefined();
  });

  it('says on the button that the options page opens in a new tab', () => {
    fake.browser = { runtime: { openOptionsPage: vi.fn(async () => {}) } };
    mountToolbar();
    expect(settingsButton()?.textContent).toBe('設定（新しいタブで開きます）');
  });

  it('says on the button that the side panel opens', () => {
    fake.browser = { sidebarAction: { open: vi.fn(async () => {}) } };
    mountToolbar();
    expect(settingsButton()?.textContent).toMatch(/^設定（サイドパネルで開きます）$/);
  });
});

describe('the way back from the options page (#68)', () => {
  it('reads the Reader tab from the page address, and nothing else', () => {
    expect(returnToTab('?returnTo=12')).toBe(12);
    expect(returnToTab('')).toBeNull();
    expect(returnToTab('?returnTo=javascript:alert(1)')).toBeNull();
  });

  it('brings the Reader tab forward, then closes the settings tab', async () => {
    const calls: string[] = [];
    fake.browser = {
      tabs: {
        getCurrent: async () => ({ id: 3 }),
        update: async (id: number) => void calls.push(`update ${id}`),
        remove: async (id: number) => void calls.push(`remove ${id}`),
      },
    };
    await returnToReader(12);
    expect(calls).toEqual(['update 12', 'remove 3']);
  });

  it('keeps the settings open when the Reader tab is gone', async () => {
    const remove = vi.fn();
    fake.browser = {
      tabs: {
        getCurrent: async () => ({ id: 3 }),
        update: async () => {
          throw new Error('No tab with id: 12');
        },
        remove,
      },
    };
    await expect(returnToReader(12)).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });

  it('offers the button only when opened from a Reader tab', async () => {
    fake.browser = {};
    await act(async () => root.render(<SettingsApp returnTo={null} />));
    expect(container.textContent).not.toContain('Back to the Reader');
    expect(container.textContent).not.toContain('リーダーに戻る');

    await act(async () => root.render(<SettingsApp returnTo={12} />));
    const back = [...container.querySelectorAll('button')].find((button) =>
      /Back to the Reader|リーダーに戻る/.test(button.textContent ?? ''),
    );
    expect(back).toBeDefined();
    // The arrow is drawn, not read: the button's name is the words.
    const arrow = back!.querySelector('[aria-hidden="true"]');
    expect(arrow?.textContent).toBe('←');
    expect(back!.textContent?.replace(arrow!.textContent!, '')).toMatch(/^(Back to the Reader|リーダーに戻る)$/);
  });
});
