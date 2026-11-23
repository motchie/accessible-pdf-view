import { messagesFor, type Locale } from '../../lib/i18n';

/** The settings page's tab title, in the interface's language. */
export function settingsPageTitle(locale: Locale): string {
  const m = messagesFor(locale);
  return `${m.settings.title} — ${m.app.name}`;
}
