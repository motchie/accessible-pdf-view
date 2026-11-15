import { afterEach, describe, expect, it } from 'vitest';
import {
  rememberUiLanguage,
  rememberedUiLanguage,
  setDocumentLanguage,
} from '../lib/i18n/document-language';

/**
 * #40: a `lang` changed after load is not picked up by the screen reader, so
 * the page's language is set before React starts, from a copy of the setting
 * that can be read at once.
 */
afterEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
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
    localStorage.setItem('apv-ui-language', 'fr');
    expect(rememberedUiLanguage()).toBe('auto');
  });

  it('falls back to `auto`, and does not throw, when storage refuses', () => {
    expect(rememberedUiLanguage(throwingStorage())).toBe('auto');
    expect(() => rememberUiLanguage('ja', throwingStorage())).not.toThrow();
  });
});

describe('setDocumentLanguage', () => {
  it('uses a language chosen in the settings, over the browser', () => {
    // jsdom's browser language is English, so `ja` here can only come from
    // the remembered choice.
    expect(navigator.languages.some((tag) => tag.startsWith('ja'))).toBe(false);
    rememberUiLanguage('ja');
    setDocumentLanguage();
    expect(document.documentElement.lang).toBe('ja');
  });

  it('follows the browser when nothing is remembered', () => {
    setDocumentLanguage();
    expect(document.documentElement.lang).toBe('en');
  });

  it('follows the browser when storage refuses', () => {
    setDocumentLanguage(document, throwingStorage());
    expect(document.documentElement.lang).toBe('en');
  });
});
