import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { Locale } from './locale';
import { en } from './en';
import { ja } from './ja';

/**
 * The Reader's own language, which is not the document's.
 *
 * Three languages meet in this extension and only one of them is this file's:
 *
 *   - **UI language** — what the Reader's own chrome is written in. Here.
 *   - **Document language** — `lang` on the article, from `/Lang` or detection.
 *   - **Description language** — what the on-device model writes in, chosen by
 *     `chooseOutputLanguage()` from the document's own declaration, or from the
 *     UI language above where the reader has said that declaration is wrong.
 *
 * Conflating them produces exactly the bug this project exists to avoid: a
 * Japanese document read aloud in an English voice, or an English UI claiming
 * a description is in Japanese.
 *
 * ## Why this is not `browser.i18n`
 *
 * Because `browser.i18n` cannot be switched at runtime — it resolves against
 * the browser's own UI language and nothing else. That is the right answer for
 * the extension's *name* in the store listing, which is why the manifest still
 * uses it, and the wrong answer for the Reader: a Japanese-language browser is
 * not a statement that this reader wants a Japanese interface. wxt-dev/wxt#2481
 * asked for precisely that and was closed as not-possible-by-design.
 *
 * ## Why this is not `i18next`
 *
 * Measured, not assumed: the Reader chunk is 497 KB against Vite's 500 KB
 * warning ceiling, and `i18next` plus `react-i18next` is another 60 KB of
 * runtime before any strings. For two locales, no gender, no ordinals and one
 * plural rule, what it buys over the fifty lines below is a silent fallback —
 * and a silent fallback is the one behaviour this catalogue must not have. The
 * provenance labels (「AIによる自動生成の説明」 and the rest) carry a claim about
 * where text came from; a missing translation that quietly renders in English
 * inside a Japanese sentence is an accessibility regression, not a cosmetic
 * one.
 *
 * So `en` is the type and `ja` must satisfy it: a key added to one and not the
 * other is a **compile error**, and `npm run compile` is the check.
 */
export type { Locale, UiLanguage } from './locale';
export { resolveLocale, UI_LANGUAGE_NAMES } from './locale';

/**
 * The catalogue's shape, taken from English with its string literals widened.
 *
 * Without the widening, `typeof en` would fix every message to the exact
 * English sentence and no translation could satisfy it. Functions are passed
 * through untouched on purpose: a message that takes a page number must take
 * the same page number in every locale, and that is worth a type error.
 */
type Widen<T> = T extends string
  ? string
  : T extends (...args: never[]) => unknown
    ? T
    : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof en>;

const CATALOGUES: Record<Locale, Messages> = { en, ja };

export function messagesFor(locale: Locale): Messages {
  return CATALOGUES[locale];
}

const MessagesContext = createContext<Messages>(en);

export function MessagesProvider({
  locale,
  children,
}: {
  locale: Locale;
  /** Optional so `createElement(MessagesProvider, { locale }, node)` type-checks
   * — the tests render notices that way, from files that have no JSX. */
  children?: ReactNode;
}): ReactNode {
  return createElement(MessagesContext.Provider, { value: messagesFor(locale) }, children);
}

export function useMessages(): Messages {
  return useContext(MessagesContext);
}

/**
 * The one piece of markup a message may carry: `**emphasis**`.
 *
 * Panels put a `<strong>` inside a sentence — 「**機械による読み取り結果**であり」 —
 * and the three ways to keep that are all worse than this one. Splitting the
 * sentence into before/emphasis/after makes it untranslatable, because the
 * emphasis does not sit in the same place in English. Putting JSX in the
 * catalogue drags React into a file the error paths also read. Dropping the
 * emphasis loses the part of the sentence that carries the warning.
 *
 * Anything else stays out. This is not a markup language, and a message that
 * wants a link or a list is a message that should be built in the component.
 */
export function rich(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) =>
    index % 2 === 0 ? part : createElement('strong', { key: index }, part),
  );
}
