import { afterEach, describe, expect, it } from 'vitest';
import { ChromeAiSession } from '../lib/ai/chrome-session';
import { canGenerateText } from '../lib/ai/generation-support';

/** One answer to "can this browser generate text", asked from every place. */
describe('canGenerateText', () => {
  const had = 'LanguageModel' in globalThis;
  const original = globalThis.LanguageModel;

  afterEach(() => {
    if (had) globalThis.LanguageModel = original;
    else delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  });

  it('is false without the model API (Firefox), and the session agrees', () => {
    delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
    expect(canGenerateText()).toBe(false);
    expect(ChromeAiSession.supported).toBe(false);
  });

  it('is true with it, and the session agrees', () => {
    globalThis.LanguageModel = {} as unknown as LanguageModelStatic;
    expect(canGenerateText()).toBe(true);
    expect(ChromeAiSession.supported).toBe(true);
  });
});
