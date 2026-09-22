import {
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { isSidePanelSupported, openSidePanel } from '../../browser/side-panel';
import { sanitizeHref } from '../../pdf/sanitize-url';
import { useMessages } from '../../i18n';

/**
 * The Reader's toolbar.
 *
 * It sits where Chrome's own PDF toolbar sits, and deliberately does *not*
 * carry what Chrome's carries. Page number, zoom percentage, fit-to-width and
 * rotate all exist to move a fixed page image around in space; once a document
 * has been rebuilt as HTML they have nothing left to operate on — the browser's
 * own zoom is better, and heading navigation replaces the page box. Copying
 * them would mean inheriting the operating model of the thing this replaces,
 * and making a screen reader user walk past a dozen controls that do nothing to
 * reach the document.
 *
 * So the bar holds four things: which view, which file, print, and the original.
 *
 * ## Where `role="toolbar"` starts and stops
 *
 * The role is on **the actions only** — print, the original, settings. The view
 * switch is a real `<select>` and sits outside it, because a closed `<select>`
 * answers Left and Right by changing its own value, and the APG's toolbar
 * pattern says in as many words to keep such a control out. (Swallowing those
 * keys with `preventDefault` would have worked in Chrome and not in Firefox —
 * Mozilla bugs 1019630, 291082, 1428992.)
 *
 * ## What the role does and does not bring
 *
 * Arrow keys move between the actions: Left and Right, Home and End, wrapping.
 * Hearing "toolbar" and finding the arrows dead is its own small failure.
 *
 * **Roving tabindex is deliberately not part of it**, though the APG pairs the
 * two and ARIA lists focus management as a SHOULD. Roving tabindex buys one
 * thing — fewer Tab stops — and sells something in return: controls that Tab
 * cannot reach at all. Someone driving the page with Tab and Enter alone, which
 * is what a two-switch setup gives you, would reach one of these three buttons
 * and never learn the others exist. Arrow keys are a keyboard interface and
 * satisfy WCAG 2.1.1, so that is conformant — and it is still a control the
 * user cannot get to.
 *
 * What is bought is small here. There are three actions, and the page already
 * opens with a skip link, so the cost of walking the bar is at most three Tab
 * presses that a user has a one-press alternative to. Keeping every control
 * tabbable *and* answering the arrows costs nobody anything: on a button the
 * arrows do nothing native, so claiming them takes nothing away.
 *
 * If this bar ever grows past half a dozen controls the arithmetic changes, and
 * the roving tabindex is worth revisiting then.
 *
 * The settings button opens the browser's side panel — not a popup, which
 * closes the moment focus leaves it. For anyone navigating with a screen
 * reader, a keyboard or a magnifier, moving focus *is* how you read. It is left
 * out entirely where no side-panel API exists, rather than shown and inert.
 */
export type ViewMode = 'reader' | 'original' | 'markdown';

export interface ViewOption {
  id: ViewMode;
  label: string;
  /** Read after the label, so the choice is not four bare English words. */
  description: string;
  disabled?: boolean;
}

export interface ReaderToolbarProps {
  views: ReadonlyArray<ViewOption>;
  active: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** The PDF's file name. Distinct from the document title in the heading —
   * one identifies the file, the other what it is about. */
  fileName: string | null;
  sourceUrl: string | null;
  /**
   * True while the "Opening PDFs" setting is sending PDFs here, which changes
   * what the link below does: it opens this Reader again rather than the
   * browser's viewer. A prop rather than a question this component asks,
   * because the answer is asynchronous and can change while the tab is open —
   * see `usePdfHandlerEnabled`.
   */
  opensInReader?: boolean;
}

/**
 * Marks a control as a stop for the arrow keys. Read from the DOM rather than
 * kept in a list, because which actions exist depends on the document (no
 * source URL, no link) and on the browser (no side-panel API, no settings
 * button) — a list would have to be kept in step with the markup, and would
 * silently break the wrap-around when it was not.
 */
const ITEM = 'data-apv-toolbar-item';

export function ReaderToolbar({
  views,
  active,
  onChange,
  fileName,
  sourceUrl,
  opensInReader = false,
}: ReaderToolbarProps): JSX.Element {
  const m = useMessages();
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  /**
   * The address arrives in this page's own URL, and since the Reader became a
   * web-accessible resource — which the redirect in `pdf-handler.ts` requires —
   * any site can open the Reader with an address of its choosing. Here that
   * address becomes an `href`, in a document running with the extension's own
   * origin, so it goes through the same sanitiser as every link lifted out of a
   * PDF. A `javascript:` URL in this position would be the extension's worst
   * day; an address that does not survive the check leaves the toolbar with no
   * link at all, exactly as a missing one does.
   */
  const originalHref = sourceUrl ? sanitizeHref(sourceUrl) : null;

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange(event.target.value as ViewMode);
  }

  // Called straight from the click: `sidePanel.open()` is only allowed during a
  // user gesture, and awaiting anything first spends it.
  function handleSettings() {
    setSettingsError(null);
    void openSidePanel().catch((cause: unknown) => {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const { key } = event;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') {
      return;
    }

    const bar = barRef.current;
    if (!bar) return;
    const items = [...bar.querySelectorAll<HTMLElement>(`[${ITEM}]`)];
    if (items.length === 0) return;

    const owner = (event.target as HTMLElement).closest<HTMLElement>(`[${ITEM}]`);
    const from = owner ? items.indexOf(owner) : -1;
    const to =
      key === 'Home'
        ? 0
        : key === 'End'
          ? items.length - 1
          : key === 'ArrowRight'
            ? (from + 1) % items.length
            : (from - 1 + items.length) % items.length;

    const next = items[to];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  return (
    <div className="apv-toolbar">
      <p className="apv-toolbar__brand">Accessible PDF View</p>

      {/* Outside the toolbar element on purpose — see the note above. */}
      <span className="apv-toolbar__view">
        <label htmlFor="apv-view-select">{m.views.selectLabel}</label>
        <select id="apv-view-select" value={active} onChange={handleChange}>
          {views.map((view) => (
            <option key={view.id} value={view.id} disabled={view.disabled}>
              {view.label} — {view.description}
            </option>
          ))}
        </select>
      </span>

      {fileName ? <span className="apv-toolbar__file">{fileName}</span> : null}

      <div
        className="apv-toolbar__actions"
        role="toolbar"
        // Named for what it operates on. The role itself supplies the word
        // "toolbar", so the label must not repeat it.
        aria-label={m.toolbar.documentActions}
        ref={barRef}
        onKeyDown={handleKeyDown}
      >
        {/* The browser's own print, which prints whichever view is showing.
            In Reader mode that means printing the rebuilt HTML — reflowed,
            at the reader's own font size. */}
        <button
          type="button"
          onClick={() => window.print()}
          data-apv-toolbar-item="print"
        >
          {m.toolbar.print}
        </button>
        {originalHref ? (
          <a
            href={originalHref}
            target="_blank"
            rel="noopener noreferrer"
            data-apv-toolbar-item="original"
          >
            {m.toolbar.originalPdf}
            {/* Visually hidden, for the same reason the new-tab note is: what
                happens is on screen a moment later. The one person it is not
                on screen for is the one being told. */}
            <span className="apv-visually-hidden">
              {opensInReader ? m.toolbar.originalOpensHere : m.app.openInNewTab}
            </span>
          </a>
        ) : null}
        {isSidePanelSupported() ? (
          <button
            type="button"
            onClick={handleSettings}
            data-apv-toolbar-item="settings"
          >
            {m.toolbar.settings}
            <span className="apv-visually-hidden">{m.app.openInSidePanel}</span>
          </button>
        ) : null}
      </div>

      {/* A failure has to be said, not swallowed: the panel opens outside this
          document, so nothing on screen would otherwise show that it did not. */}
      {settingsError ? (
        <p role="alert" className="apv-toolbar__error">
          {m.toolbar.settingsFailed(settingsError)}
        </p>
      ) : null}
    </div>
  );
}
