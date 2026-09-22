import { useEffect, type JSX } from 'react';
import { MessagesProvider, resolveLocale } from '../../lib/i18n';
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
  }, [locale]);

  return (
    <MessagesProvider locale={locale}>
      <main className="apv-sidepanel" aria-busy={!loaded}>
        <SettingsPanel settings={settings} onChange={update} onReset={reset} />
      </main>
    </MessagesProvider>
  );
}
