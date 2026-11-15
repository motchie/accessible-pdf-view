import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type ReaderSettings } from '../lib/reader/settings';

/**
 * The hook keeps a copy of the interface language for the next page to start
 * in (#40), and only once the stored setting is known: the defaults it paints
 * before then would overwrite a real choice with `auto`.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let resolveStored: (value: Partial<ReaderSettings>) => void = () => {};
vi.mock('../lib/reader/settings-storage', () => ({
  readerSettings: {
    getValue: () => new Promise((resolve) => { resolveStored = resolve; }),
    watch: () => () => {},
    setValue: async () => {},
  },
}));

const { useReaderSettings } = await import('../lib/reader/use-settings');

let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useReaderSettings>;

function Probe() {
  api = useReaderSettings();
  return null;
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the copy of the interface language', () => {
  it('is not written from the defaults before storage answers', async () => {
    localStorage.setItem('apv-ui-language', 'ja');
    await act(async () => root.render(<Probe />));
    expect(api.loaded).toBe(false);
    expect(localStorage.getItem('apv-ui-language')).toBe('ja');
  });

  it('follows the stored setting, then every change', async () => {
    await act(async () => root.render(<Probe />));
    await act(async () => resolveStored({ ...DEFAULT_SETTINGS, uiLanguage: 'ja' }));
    expect(localStorage.getItem('apv-ui-language')).toBe('ja');

    await act(async () => api.update({ uiLanguage: 'en' }));
    expect(localStorage.getItem('apv-ui-language')).toBe('en');

    await act(async () => api.reset());
    expect(localStorage.getItem('apv-ui-language')).toBe('auto');
  });
});
