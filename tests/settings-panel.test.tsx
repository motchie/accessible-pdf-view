import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../lib/reader/components/SettingsPanel';
import { DEFAULT_SETTINGS } from '../lib/reader/settings';
import { inLocale } from './helpers/messages';

/**
 * "Language of AI-generated text" is a setting for the on-device model, and
 * offering it where there is no model is a control that does nothing — in
 * Firefox, which has no model an extension can use, that is every time the
 * panel opens. The interface-language hint points at that section by name, so
 * it has to stop pointing when the section goes.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalLanguageModel = globalThis.LanguageModel;

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
  globalThis.LanguageModel = originalLanguageModel;
});

function stubLanguageModel(availability: 'available' | 'unavailable') {
  globalThis.LanguageModel = {
    availability: vi.fn(async () => availability),
    create: vi.fn(),
    params: vi.fn(async () => null),
  } as unknown as LanguageModelStatic;
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      inLocale(
        'ja',
        <SettingsPanel settings={DEFAULT_SETTINGS} onChange={() => {}} onReset={() => {}} />,
      ),
    );
  });
}

function legends(): string[] {
  return [...container.querySelectorAll('legend')].map((legend) => legend.textContent ?? '');
}

const AI_LANGUAGE = 'AI が生成する文章の言語';
const INTERFACE_HINT = 'この拡張機能の画面の言語です。文書そのものの言語は変わりません。';

describe('the AI language section', () => {
  it('is left out where the browser has no model API (Firefox)', async () => {
    // Removing the global is the Firefox case.
    delete globalThis.LanguageModel;
    await mount();

    expect(legends()).not.toContain(AI_LANGUAGE);
    expect(container.textContent).not.toContain(`「${AI_LANGUAGE}」`);
    expect(container.textContent).toContain(INTERFACE_HINT);
  });

  it('is left out where the model cannot run', async () => {
    stubLanguageModel('unavailable');
    await mount();

    expect(legends()).not.toContain(AI_LANGUAGE);
    expect(container.textContent).not.toContain(`「${AI_LANGUAGE}」`);
  });

  it('is offered, and pointed at, where the model can run', async () => {
    stubLanguageModel('available');
    await mount();

    expect(legends()).toContain(AI_LANGUAGE);
    expect(container.textContent).toContain(`${INTERFACE_HINT}AI が生成する文章の言語も`);
  });
});
