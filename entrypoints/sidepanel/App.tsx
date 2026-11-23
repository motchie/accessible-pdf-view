import { useEffect, type JSX } from 'react';
import { MessagesProvider, resolveLocale } from '../../lib/i18n';
import { settingsPageTitle } from './title';
import { SettingsPanel } from '../../lib/reader/components/SettingsPanel';
import { useAppliedSettings, useReaderSettings } from '../../lib/reader/use-settings';

/**
 * The settings surface, in the browser's side panel.
 *
 * A separate document from the Reader — a side panel cannot reach into the page
 * beside it. Storage carries the change across: this writes, and every open
 * Reader is watching.
 *
 * It applies the settings to itself too, so the reader can see what a font or
 * theme choice does without switching windows.
 */
export default function App(): JSX.Element {
  const { settings, update, reset, loaded } = useReaderSettings();
  useAppliedSettings(settings);

  // Its own document, so its own `lang`: this panel is where the language is
  // chosen, and it has to be read out correctly in whichever one is chosen.
  const locale = resolveLocale(settings.uiLanguage);
  useEffect(() => {
    document.documentElement.lang = locale;
    // In the interface's language too. As the options page this is a tab of
    // its own (#68), and a tab's title is what a screen reader reads out in
    // the list of tabs; the HTML's English title is only the fallback.
    document.title = settingsPageTitle(locale);
  }, [locale]);

  return (
    <MessagesProvider locale={locale}>
      {/* A new element, created with the language, whenever it changes —
          Firefox keeps the one an element was created with (#40). */}
      <main key={locale} lang={locale} className="apv-sidepanel" aria-busy={!loaded}>
        <SettingsPanel settings={settings} onChange={update} onReset={reset} />
      </main>
    </MessagesProvider>
  );
}
