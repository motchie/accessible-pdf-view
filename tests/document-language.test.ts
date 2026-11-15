import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  UI_LANGUAGE_KEY,
  rememberUiLanguage,
  rememberedUiLanguage,
} from '../lib/i18n/document-language';
import { resolveLocale } from '../lib/i18n/locale';

/**
 * #40: Firefox passes screen readers the `lang` an element was created with,
 * so the page's language is set by a plain script at the top of <head>, from a
 * copy of the setting that can be read before the body exists.
 */
const root = resolve(import.meta.dirname, '..');
const script = readFileSync(resolve(root, 'public/document-language.js'), 'utf8');
const realLanguages = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'languages');

function withBrowserLanguages(languages: string[]): void {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => languages });
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
  delete (navigator as { languages?: unknown }).languages;
  if (realLanguages) Object.defineProperty(Object.getPrototypeOf(navigator), 'languages', realLanguages);
});

function throwingStorage(): Storage {
  return {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  } as unknown as Storage;
}

describe('the remembered interface language', () => {
  it('is `auto` until something is remembered', () => {
    expect(rememberedUiLanguage()).toBe('auto');
  });

  it('is what was remembered', () => {
    rememberUiLanguage('ja');
    expect(rememberedUiLanguage()).toBe('ja');
    rememberUiLanguage('en');
    expect(rememberedUiLanguage()).toBe('en');
  });

  it('ignores a value it did not write', () => {
    localStorage.setItem(UI_LANGUAGE_KEY, 'fr');
    expect(rememberedUiLanguage()).toBe('auto');
  });

  it('falls back to `auto`, and does not throw, when storage refuses', () => {
    expect(rememberedUiLanguage(throwingStorage())).toBe('auto');
    expect(() => rememberUiLanguage('ja', throwingStorage())).not.toThrow();
  });
});

describe('public/document-language.js', () => {
  /**
   * It cannot import the TypeScript — it runs before any module — so it says
   * the same things again. This keeps them saying the same thing: every stored
   * value it might find, against browsers that do and do not prefer Japanese.
   */
  it.each([
    [null, ['en-US']],
    [null, ['ja', 'en-US']],
    [null, ['en-GB', 'ja']],
    ['auto', ['ja-JP']],
    ['en', ['ja']],
    ['ja', ['en-US']],
    ['fr', ['ja']],
  ] as const)('with %s stored and a browser preferring %j, sets what the Reader resolves', (stored, languages) => {
    withBrowserLanguages([...languages]);
    if (stored !== null) localStorage.setItem(UI_LANGUAGE_KEY, stored);

    new Function(script)();

    expect(document.documentElement.lang).toBe(resolveLocale(rememberedUiLanguage()));
  });

  it('reads the key the Reader writes', () => {
    expect(script).toContain(`'${UI_LANGUAGE_KEY}'`);
  });

  it('is the first script in the head of both pages, and not a module', () => {
    for (const page of ['entrypoints/reader/index.html', 'entrypoints/sidepanel/index.html']) {
      const html = readFileSync(resolve(root, page), 'utf8');
      const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
      const scripts = [...head.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
      expect(scripts[0], page).toBe('<script src="/document-language.js">');
      // And nothing before the body's parsing that could run first.
      expect(html.indexOf('<script src="/document-language.js">'), page).toBeLessThan(html.indexOf('<body'));
    }
  });
});
