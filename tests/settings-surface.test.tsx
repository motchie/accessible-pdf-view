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

const { openSettings, settingsSurface } = await import('../lib/browser/side-panel');
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
    fake.browser = { runtime: { openOptionsPage } };

    expect(settingsSurface()).toBe('options-page');
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
