import { useEffect, useId, useRef, useState, type JSX } from 'react';
import { ChromeAiFigureDescriber } from '../../pdf/describe/chrome-ai-describer';
import type { DescriberAvailability } from '../../pdf/describe/provider';
import type { ReaderSettings } from '../settings';
import { STRUCTURE_ORDER } from '../structure-source';
import { UI_LANGUAGE_NAMES, resolveLocale, useMessages } from '../../i18n';
import { downloadPercent } from '../download-progress';
import {
  disablePdfHandler,
  enablePdfHandler,
  isPdfHandlerEnabled,
  isPdfHandlerSupported,
} from '../../browser/pdf-handler';

/**
 * The settings, as shown in the extension's side panel.
 *
 * **Why a side panel and not a popup.** A popup closes when it loses focus.
 * For anyone navigating with a screen reader, a keyboard or a magnifier,
 * moving focus *is* how you read — so a surface that dismisses itself on focus
 * loss is close to unusable. A side panel stays, and the reader can change a
 * setting and look at the result without the panel disappearing.
 *
 * Each group is a `fieldset` with a `legend`, so the panel can be navigated by
 * its structure rather than by tabbing through everything. Every choice is a
 * radio group: a named step is easier to confirm with a screen reader than a
 * slider's position, and the steps are values the Reader's layout is known to
 * survive.
 */
export interface SettingsPanelProps {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onReset: () => void;
}

interface Choice<T extends string> {
  value: T;
  label: string;
  note?: string;
}

/** Which viewer opens a PDF, as the two radio values name it. */
type PdfHandler = 'browser' | 'reader';

export function SettingsPanel({
  settings,
  onChange,
  onReset,
}: SettingsPanelProps): JSX.Element {
  const m = useMessages();

  return (
    <div className="apv-settings">
      <h1 className="apv-settings__title">{m.settings.title}</h1>

      {/* First, because it changes the words of every control under it. */}
      <fieldset>
        <legend>{m.settings.language}</legend>
        <p className="apv-settings__hint">{m.settings.languageHint}</p>
        <RadioGroup
          label={m.settings.language}
          labelHidden
          value={settings.uiLanguage}
          onChange={(uiLanguage) => onChange({ uiLanguage })}
          choices={[
            {
              value: 'auto',
              label: m.settings.languageAuto,
              // Says what "auto" resolves to right now. A control whose effect
              // you cannot see until you pick it is one you have to experiment
              // with.
              note: m.settings.languageAutoNote(UI_LANGUAGE_NAMES[resolveLocale('auto')]),
            },
            { value: 'en', label: UI_LANGUAGE_NAMES.en },
            { value: 'ja', label: UI_LANGUAGE_NAMES.ja },
          ]}
        />
      </fieldset>

      <fieldset>
        <legend>{m.settings.textAndSpacing}</legend>
        <p className="apv-settings__hint">{m.settings.zoomHint}</p>
        <RadioGroup
          label={m.settings.fontSize}
          value={settings.fontScale}
          onChange={(fontScale) => onChange({ fontScale })}
          choices={[
            { value: 'small', label: m.settings.fontSizes.small },
            { value: 'normal', label: m.settings.fontSizes.normal },
            { value: 'large', label: m.settings.fontSizes.large },
            { value: 'xlarge', label: m.settings.fontSizes.xlarge },
          ]}
        />
        <RadioGroup
          label={m.settings.lineHeight}
          value={settings.lineHeight}
          onChange={(lineHeight) => onChange({ lineHeight })}
          choices={[
            { value: 'normal', label: m.settings.lineHeights.normal },
            { value: 'relaxed', label: m.settings.lineHeights.relaxed },
            { value: 'loose', label: m.settings.lineHeights.loose },
          ]}
        />
        <RadioGroup
          label={m.settings.measure}
          value={settings.measure}
          onChange={(measure) => onChange({ measure })}
          choices={[
            { value: 'narrow', label: m.settings.measures.narrow },
            { value: 'normal', label: m.settings.measures.normal },
            { value: 'wide', label: m.settings.measures.wide },
          ]}
        />
      </fieldset>

      <fieldset>
        <legend>{m.settings.typeface}</legend>
        <RadioGroup
          label={m.settings.typeface}
          labelHidden
          value={settings.typeface}
          onChange={(typeface) => onChange({ typeface })}
          choices={[
            { value: 'system', label: m.settings.typefaces.system },
            { value: 'ud', label: 'BIZ UDPGothic', note: m.settings.typefaces.udNote },
            {
              value: 'hyperlegible',
              label: 'Atkinson Hyperlegible',
              note: m.settings.typefaces.hyperlegibleNote,
            },
          ]}
        />
        {/* Said plainly rather than implied: nothing is downloaded, so a face
            the reader does not have installed simply falls through to the
            system default. Promising more would be a claim they cannot check. */}
        <p className="apv-settings__hint">{m.settings.typefaceHint}</p>
      </fieldset>

      <fieldset>
        <legend>{m.settings.theme}</legend>
        <RadioGroup
          label={m.settings.theme}
          labelHidden
          value={settings.theme}
          onChange={(theme) => onChange({ theme })}
          choices={[
            { value: 'system', label: m.settings.themes.system },
            { value: 'light', label: m.settings.themes.light },
            { value: 'dark', label: m.settings.themes.dark },
          ]}
        />
        <p className="apv-settings__hint">{m.settings.themeHint}</p>
      </fieldset>

      <ModelSection />

      {/* Next to the model, because it is about what that model writes, and
          nowhere near the top because the default is right for most documents.
          It is the control to reach for when one particular PDF declares a
          language it is not written in. */}
      <fieldset>
        <legend>{m.settings.aiLanguage}</legend>
        <p className="apv-settings__hint">{m.settings.aiLanguageHint}</p>
        <RadioGroup
          label={m.settings.aiLanguage}
          labelHidden
          value={settings.aiLanguage}
          onChange={(aiLanguage) => onChange({ aiLanguage })}
          choices={[
            {
              value: 'document',
              label: m.settings.aiLanguageDocument,
              note: m.settings.aiLanguageDocumentNote,
            },
            {
              value: 'interface',
              label: m.settings.aiLanguageInterface,
              // Named rather than pointed at: "the interface language" is a
              // reference to another control, and going to look it up to find
              // out what this one would do is work worth saving.
              note: m.settings.aiLanguageInterfaceNote(
                UI_LANGUAGE_NAMES[resolveLocale(settings.uiLanguage)],
              ),
            },
          ]}
        />
      </fieldset>

      <fieldset>
        <legend>{m.structure.legend}</legend>
        <p className="apv-settings__hint">{m.settings.structureHint}</p>
        <RadioGroup
          label={m.structure.legend}
          labelHidden
          value={settings.structureSource}
          onChange={(structureSource) => onChange({ structureSource })}
          choices={STRUCTURE_ORDER.map((origin) => ({
            value: origin,
            label: m.structure.sources[origin].label,
            note: m.structure.sources[origin].detail,
          }))}
        />
      </fieldset>

      <PdfHandlerSection />

      <fieldset>
        <legend>{m.settings.storage}</legend>
        <p className="apv-settings__hint">{m.settings.storageHint}</p>
        <p>
          <button type="button" onClick={onReset}>
            {m.settings.reset}
          </button>
        </p>
      </fieldset>
    </div>
  );
}

/**
 * Which viewer opens a PDF.
 *
 * Unlike every other control in this panel, this one is not a stored
 * preference. It reports two things the browser owns — whether host access was
 * granted, and whether the redirect rule is installed — and either can change
 * without this extension running: the browser's own extensions page can take
 * the access back at any time. A stored copy would be a third answer that is
 * sometimes wrong, so the state is read from the browser on mount and read
 * again after every change, and the control shows what is true rather than what
 * was asked for.
 *
 * It is also why this cannot live in `ReaderSettings`: those are synced, and a
 * permission is granted on one machine.
 *
 * Left out entirely where the APIs do not exist, like the settings button in
 * the toolbar. That is absence of an API rather than of a device capability —
 * there is nothing to explain and nothing anyone could do about it — which is
 * the opposite of the model section below, where saying why matters.
 */
function PdfHandlerSection(): JSX.Element | null {
  const m = useMessages();
  const [handler, setHandler] = useState<PdfHandler | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isPdfHandlerEnabled().then((enabled) => {
      if (!cancelled) setHandler(enabled ? 'reader' : 'browser');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isPdfHandlerSupported() || handler === null) return null;

  async function choose(next: PdfHandler) {
    // The radios stay focusable while the browser's prompt is open (see
    // `RadioGroup`'s `busy`), so a second answer has to be refused here rather
    // than by the browser.
    if (busy) return;
    setRefused(false);
    setError(null);
    setBusy(true);
    try {
      // Called with nothing awaited before it: the permission prompt is only
      // allowed while the click that led here is still a live user gesture.
      if (next === 'reader') setRefused(!(await enablePdfHandler()));
      else await disablePdfHandler();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      // Asked again rather than assumed. The permission can be granted and the
      // rule still fail to install, and a control that moved on the request
      // alone would be claiming something nobody checked.
      setHandler((await isPdfHandlerEnabled()) ? 'reader' : 'browser');
      setBusy(false);
    }
  }

  return (
    <fieldset>
      <legend>{m.settings.pdfHandler}</legend>
      <p className="apv-settings__hint">{m.settings.pdfHandlerHint}</p>
      <RadioGroup
        label={m.settings.pdfHandler}
        labelHidden
        value={handler}
        busy={busy}
        onChange={(next) => void choose(next)}
        choices={[
          {
            value: 'browser',
            label: m.settings.pdfHandlerBrowser,
            note: m.settings.pdfHandlerBrowserNote,
          },
          {
            value: 'reader',
            label: m.settings.pdfHandlerReader,
            note: m.settings.pdfHandlerReaderNote,
          },
        ]}
      />
      {/* What it will not catch, said before it is tried rather than left to be
          discovered on the first local file. */}
      <p className="apv-settings__hint">{m.settings.pdfHandlerLimits}</p>

      {/* Declining the prompt is an answer, not a failure — but it has to be
          said, because the control snapping back is the only other evidence. */}
      {refused ? (
        <p role="alert" className="apv-settings__note">
          {m.settings.pdfHandlerRefused}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="apv-settings__note">
          {m.settings.pdfHandlerFailed(error)}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * The on-device model, prepared before it is needed.
 *
 * Chrome downloads the model on the first `create()` call, which means the
 * first time a reader asks for an image description they wait several gigabytes
 * for an answer. Chrome resumes an interrupted download and survives a restart,
 * so the useful lever is not caching but *when* the wait starts — here, on
 * purpose, before a document is open.
 */
function ModelSection(): JSX.Element | null {
  const m = useMessages();
  const [availability, setAvailability] = useState<DescriberAvailability | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const describerRef = useRef<ChromeAiFigureDescriber | null>(null);

  useEffect(() => {
    let cancelled = false;
    const describer = new ChromeAiFigureDescriber();
    describerRef.current = describer;

    void describer.isAvailable().then((result) => {
      if (!cancelled) setAvailability(result);
    });

    return () => {
      cancelled = true;
      void describer.dispose();
      describerRef.current = null;
    };
  }, []);

  if (!availability) return null;

  async function prepare() {
    // The button is `aria-disabled` rather than `disabled`, so it keeps focus
    // and can still be pressed. Refusing a second press is the other half.
    if (progress !== null) return;
    setError(null);
    setProgress(0);
    try {
      await describerRef.current?.prepare({
        onDownloadProgress: (loaded) => setProgress(loaded),
      });
      setAvailability({ status: 'available' });
      setProgress(null);
    } catch (cause) {
      setProgress(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  // Ten steps rather than every value the download reports: the line below is a
  // live region, and a percentage that changes a hundred times is a hundred
  // announcements. `null` until the first step — see `downloadPercent`.
  const percent = progress === null ? null : downloadPercent(progress);

  return (
    <fieldset>
      <legend>{m.settings.model}</legend>
      <p className="apv-settings__hint">{m.settings.modelHint}</p>

      {availability.status === 'unavailable' ? (
        // Not hidden. Without seeing the whole screen, there is no way to tell
        // a missing feature from one that was simply not found.
        <p className="apv-settings__note">
          {m.settings.modelUnavailable} {m.settings.modelUnavailableReason[availability.reason]}
        </p>
      ) : availability.status === 'available' ? (
        <p className="apv-settings__note">{m.settings.modelReady}</p>
      ) : (
        <>
          <p className="apv-settings__note">
            {m.settings.modelDownloadable}
          </p>
          <p>
            {/* `aria-disabled`, not `disabled`: a disabled element cannot
                hold focus, and this button starts a download of several
                gigabytes — dropping the user at the top of the panel as it
                begins takes away the progress line below with it. */}
            <button type="button" onClick={prepare} aria-disabled={progress !== null}>
              {progress === null ? m.settings.modelPrepare : m.settings.modelPreparing}
            </button>
          </p>
        </>
      )}

      <p role="status" className="apv-settings__note">
        {progress === null
          ? ''
          : percent === null
            ? m.settings.modelPreparingPlain
            : m.settings.modelPreparingAt(percent)}
      </p>

      {error ? (
        <p role="alert" className="apv-settings__note">
          {m.settings.modelFailed(error)}
        </p>
      ) : null}
    </fieldset>
  );
}

/** A radio group. Radios rather than a slider or a select, because the reader
 * has to be able to confirm which step is current without seeing it. */
function RadioGroup<T extends string>({
  label,
  labelHidden,
  value,
  choices,
  busy,
  onChange,
}: {
  label: string;
  labelHidden?: boolean;
  value: T;
  choices: ReadonlyArray<Choice<T>>;
  /**
   * For a choice that is not ours to make instantly — the PDF handler waits on
   * the browser's own permission prompt, and a second answer while the first is
   * still open would race it.
   *
   * `aria-disabled`, not `disabled`. A disabled input cannot hold focus, so the
   * radio the user just answered would throw focus to the top of the panel and
   * leave them looking for the answer. The caller refuses the second press.
   */
  busy?: boolean;
  onChange: (value: T) => void;
}): JSX.Element {
  const name = useId();

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="apv-settings__group"
    >
      {labelHidden ? null : <p className="apv-settings__label">{label}</p>}
      {choices.map((choice) => (
        <label key={choice.value} className="apv-settings__choice">
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            aria-disabled={busy}
            onChange={() => onChange(choice.value)}
          />
          <span>
            {choice.label}
            {choice.note ? (
              <span className="apv-settings__choice-note"> — {choice.note}</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
}
