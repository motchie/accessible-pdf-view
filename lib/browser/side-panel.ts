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
  // One settings tab, not one per press: a reader who went back through the
  // tab switcher rather than the page's own button would otherwise pile them
  // up. The open one is pointed at this Reader tab and brought forward — but
  // only while it still shows the settings: a tab the reader has since taken
  // to another page is theirs, and is not navigated away.
  const open = (await recordedSettingsTab())?.tab;
  if (open != null && open !== current.id && (await showsSettings(open))) {
    try {
      await browser.tabs.update(open, { active: true, url: settingsPageUrl(current.id) });
      return;
    } catch {
      // Closed since it was checked: open a new one.
    }
  }
  await browser.tabs.create({ url: settingsPageUrl(current.id) });
}

/** Whether tab `id` is showing this extension's options page now. */
async function showsSettings(id: number): Promise<boolean> {
  try {
    const tab = await browser.tabs.get(id);
    // An extension sees its own pages' addresses. Where it does not, the tab
    // is not reused: a second settings tab is the safe mistake.
    return typeof tab?.url === 'string' && tab.url.startsWith(browser.runtime.getURL('/options.html'));
  } catch {
    return false;
  }
}

/**
 * The settings tab, as the options page records it for itself in the
 * browser's session storage while it is open (`rememberSettingsTab`), with a
 * token of that page's own: a page reloaded in the same tab must not have its
 * record removed by the page it replaced (`forgetSettingsTab`). Session
 * storage is cleared when the browser closes; `showsSettings` covers a record
 * that outlived its page.
 */
const SETTINGS_TAB_KEY = 'apv-settings-tab';

interface SettingsTabRecord {
  tab: number;
  token: string;
}

type SessionArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};

function sessionArea(): SessionArea | undefined {
  return (browser as unknown as { storage?: { session?: SessionArea } } | undefined)?.storage
    ?.session;
}

async function recordedSettingsTab(): Promise<SettingsTabRecord | null> {
  try {
    const value = (await sessionArea()?.get(SETTINGS_TAB_KEY))?.[SETTINGS_TAB_KEY] as
      | Partial<SettingsTabRecord>
      | undefined;
    return typeof value?.tab === 'number' && typeof value.token === 'string'
      ? { tab: value.tab, token: value.token }
      : null;
  } catch {
    return null;
  }
}

/** This page's token, made once when it loads. */
const pageToken =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : String(Math.random()).slice(2);

/** Called by the options page when it loads. */
export async function rememberSettingsTab(): Promise<void> {
  const current = await browser.tabs.getCurrent();
  if (current?.id != null) {
    const record: SettingsTabRecord = { tab: current.id, token: pageToken };
    await sessionArea()?.set({ [SETTINGS_TAB_KEY]: record });
  }
}

/** Called by the options page as it goes; removes only its own record. */
export async function forgetSettingsTab(): Promise<void> {
  if ((await recordedSettingsTab())?.token === pageToken) {
    await sessionArea()?.remove(SETTINGS_TAB_KEY);
  }
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
  const reader = await browser.tabs.update(readerTab, { active: true });
  // The Reader may be in another window, on a desktop browser: bring that
  // window forward too. Where there is no windows API (Firefox for Android,
  // with one window) there is nothing to do.
  const windows = (browser as unknown as {
    windows?: { update?: (id: number, info: { focused: boolean }) => Promise<unknown> };
  }).windows;
  if (reader?.windowId != null && windows?.update) {
    await windows.update(reader.windowId, { focused: true }).catch(() => {});
  }
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
