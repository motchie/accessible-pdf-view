import { useEffect, useState, type JSX } from 'react';
import { returnToReader } from '../../lib/browser/side-panel';
import { MessagesProvider, messagesFor, resolveLocale } from '../../lib/i18n';
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
export default function App({
  returnTo = null,
}: {
  /**
   * The Reader tab that opened this as the options page, which then offers a
   * way back to it (#68). Null in the side panel, and when opened from the
   * browser's add-on manager, which has its own.
   */
  returnTo?: number | null;
} = {}): JSX.Element {
  const { settings, update, reset, loaded } = useReaderSettings();
  const [returnFailed, setReturnFailed] = useState(false);
  useAppliedSettings(settings);

  // Its own document, so its own `lang`: this panel is where the language is
  // chosen, and it has to be read out correctly in whichever one is chosen.
  const locale = resolveLocale(settings.uiLanguage);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <MessagesProvider locale={locale}>
      {/* A new element, created with the language, whenever it changes —
          Firefox keeps the one an element was created with (#40). */}
      <main key={locale} lang={locale} className="apv-sidepanel" aria-busy={!loaded}>
        {returnTo !== null ? (
          <p className="apv-settings__return">
            <button
              type="button"
              onClick={() => {
                setReturnFailed(false);
                returnToReader(returnTo).catch(() => setReturnFailed(true));
              }}
            >
              {messagesFor(locale).settings.backToReader}
            </button>
            {returnFailed ? (
              <span role="alert" className="apv-settings__return-failed">
                {messagesFor(locale).settings.backToReaderFailed}
              </span>
            ) : null}
          </p>
        ) : null}
        <SettingsPanel settings={settings} onChange={update} onReset={reset} />
      </main>
    </MessagesProvider>
  );
}
