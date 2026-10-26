import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../lib/reader/components/SettingsPanel';
import { DEFAULT_SETTINGS } from '../lib/reader/settings';
import { inLocale } from './helpers/messages';

/**
 * "Language of AI-generated text" is a setting for the on-device model, and
 * offering it where there is no model API is a control that does nothing — in
 * Firefox, which has no model an extension can use, that is every time the
 * panel opens. The interface-language hint points at that section by name, so
 * it has to stop pointing when the section goes.
 *
 * Whether the section is there is decided by the API's presence, not by the
 * model's availability, and the tests pin both halves of that: every
 * availability the probe can report keeps the section, and the section is
 * there before the probe has answered — so the panel never changes under
 * someone already reading it.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const hadLanguageModel = 'LanguageModel' in globalThis;
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
  // Put back what was there, absence included: assigning `undefined` would
  // leave the property behind for every later test in this worker.
  if (hadLanguageModel) {
    globalThis.LanguageModel = originalLanguageModel;
  } else {
    removeLanguageModel();
  }
});

/** The Firefox case: no such global at all. */
function removeLanguageModel(): void {
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
}

function stubLanguageModel(availability: () => Promise<string>): void {
  globalThis.LanguageModel = {
    availability: vi.fn(availability),
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
const POINTER = `${INTERFACE_HINT}AI が生成する文章の言語も`;

describe('the AI language section', () => {
  it('is left out where the browser has no model API (Firefox)', async () => {
    removeLanguageModel();
    await mount();

    expect(legends()).not.toContain(AI_LANGUAGE);
    expect(container.textContent).not.toContain(`「${AI_LANGUAGE}」`);
    expect(container.textContent).toContain(INTERFACE_HINT);
  });

  it.each(['available', 'downloadable', 'downloading', 'unavailable'])(
    'is offered, and pointed at, where the API exists and the model is %s',
    async (availability) => {
      stubLanguageModel(async () => availability);
      await mount();

      expect(legends()).toContain(AI_LANGUAGE);
      expect(container.textContent).toContain(POINTER);
    },
  );

  it('is there from the first render, before the probe answers', async () => {
    stubLanguageModel(() => new Promise<string>(() => {}));
    await mount();

    expect(legends()).toContain(AI_LANGUAGE);
    expect(container.textContent).toContain(POINTER);
  });

  it('stays when the probe fails', async () => {
    stubLanguageModel(async () => {
      throw new Error('model service busy');
    });
    await mount();

    expect(legends()).toContain(AI_LANGUAGE);
  });
});
