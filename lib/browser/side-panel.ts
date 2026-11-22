import { browser } from 'wxt/browser';

/**
 * Opening the settings panel.
 *
 * Two APIs for one idea. Chromium has `sidePanel.open()`, which **must be
 * called during a user gesture** — so this runs from the click handler in the
 * Reader's toolbar, not from the background. Firefox has `sidebarAction.open()`
 * instead, and WXT emits the matching manifest key for each target from the
 * same entrypoint file.
 *
 * `isSupported` exists so the toolbar can leave the button out rather than
 * show one that does nothing. A control that fails silently is worse than an
 * absent one for someone who cannot see that nothing happened.
 */
interface SidePanelApi {
  open(options: { tabId?: number; windowId?: number }): Promise<void>;
}
interface SidebarActionApi {
  open(): Promise<void>;
}

/**
 * `browser` itself is absent outside an extension context — in a unit test, and
 * in any page this code is reused from later. Reading through it unguarded is a
 * crash, not a missing feature, so both accessors treat "no API" and "no
 * browser" as the same answer.
 */
type MaybeApis =
  | {
      sidePanel?: SidePanelApi;
      sidebarAction?: SidebarActionApi;
      runtime?: { openOptionsPage?: () => Promise<void> };
    }
  | undefined;

function apis(): MaybeApis {
  return browser as unknown as MaybeApis;
}

function chromium(): SidePanelApi | undefined {
  return apis()?.sidePanel;
}

function firefox(): SidebarActionApi | undefined {
  return apis()?.sidebarAction;
}

export function isSidePanelSupported(): boolean {
  return Boolean(chromium()?.open ?? firefox()?.open);
}

/**
 * Where the settings open: the side panel (Chrome) or sidebar (desktop
 * Firefox) where there is one, else the extension's options page, a screen of
 * its own — Firefox for Android has no sidebar (#68). Null where there is
 * neither, and the toolbar then leaves its Settings button out.
 */
export type SettingsSurface = 'side-panel' | 'options-page';

export function settingsSurface(): SettingsSurface | null {
  if (isSidePanelSupported()) return 'side-panel';
  return apis()?.runtime?.openOptionsPage ? 'options-page' : null;
}

/**
 * Opens the settings where `settingsSurface` says they are.
 *
 * The options page is opened as a tab that knows which Reader tab opened it
 * (`?returnTo=`), so it can offer a way back: on Firefox for Android the page
 * fills the screen, and the only other way back is the tab switcher (#68).
 * `openOptionsPage()` cannot carry that, so it is the fallback when the
 * calling tab is unknown.
 */
export async function openSettings(): Promise<void> {
  if (isSidePanelSupported()) {
    await openSidePanel();
    return;
  }
  if (!apis()?.runtime?.openOptionsPage) {
    throw new Error('The settings cannot be opened in this environment.');
  }
  const current = await browser.tabs.getCurrent();
  if (current?.id == null) {
    await apis()!.runtime!.openOptionsPage!();
    return;
  }
  await browser.tabs.create({ url: settingsPageUrl(current.id) });
}

/** The options page, told which tab to return to. */
export function settingsPageUrl(returnTo: number): string {
  return `${browser.runtime.getURL('/options.html')}?returnTo=${returnTo}`;
}

/** The tab the options page should return to, from its own address. */
export function returnToTab(search: string): number | null {
  const value = new URLSearchParams(search).get('returnTo');
  return value !== null && /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * Brings the Reader tab back and closes the settings tab. Rejects, leaving
 * the settings open, when the Reader tab is gone.
 */
export async function returnToReader(readerTab: number): Promise<void> {
  const current = await browser.tabs.getCurrent();
  await browser.tabs.update(readerTab, { active: true });
  if (current?.id != null) await browser.tabs.remove(current.id);
}

/**
 * Opens the panel for the calling tab. Must be called synchronously enough from
 * a real click that the browser still counts it as a user gesture — awaiting
 * anything slow first is what makes this fail.
 */
export async function openSidePanel(): Promise<void> {
  const sidebar = firefox();
  if (sidebar?.open) {
    await sidebar.open();
    return;
  }

  const panel = chromium();
  if (!panel?.open) throw new Error('The side panel cannot be opened in this environment.');

  // `tabId` scopes the panel to this document's own tab. `tabs.getCurrent()`
  // is available to an extension page and returns the tab it is rendered in.
  const tab = await browser.tabs.getCurrent();
  await panel.open(tab?.id != null ? { tabId: tab.id } : { windowId: browser.windows.WINDOW_ID_CURRENT });
}
