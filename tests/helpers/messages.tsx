import type { ReactNode } from 'react';
import { MessagesProvider, type Locale } from '../../lib/i18n';

/**
 * Renders a component in a fixed UI locale.
 *
 * Every component test that asserts wording has to choose a locale, and the
 * choice is not a formality: these assertions are the safeguard on text that
 * states where a piece of the document came from, and a test that asserts a
 * message *key* would pass while the sentence said the wrong thing.
 *
 * Most suites pin `ja`, because those assertions were written against the
 * Japanese originals and are unchanged by the move to a catalogue — the
 * safeguard is the same one it always was. The messages that carry a claim
 * about provenance are additionally pinned in `en`, in the suites that own
 * them, because a base language nothing checks is a base language that drifts.
 */
export function inLocale(locale: Locale, children: ReactNode): ReactNode {
  return <MessagesProvider locale={locale}>{children}</MessagesProvider>;
}
