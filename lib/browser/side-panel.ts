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
interface RuntimeApi {
  openOptionsPage?(): Promise<void>;
}

/**
 * `browser` itself is absent outside an extension context — in a unit test, and
 * in any page this code is reused from later. Reading through it unguarded is a
 * crash, not a missing feature, so both accessors treat "no API" and "no
 * browser" as the same answer.
 */
type MaybeApis =
  | { sidePanel?: SidePanelApi; sidebarAction?: SidebarActionApi; runtime?: RuntimeApi }
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
 * Where the Reader's Settings button takes the reader, or null for nowhere.
 *
 * The side panel wherever there is one. Where there is not — Firefox for
 * Android, which has no sidebar (#68) — the options page, which shows the same
 * panel in a tab of its own. The Reader says which, because the two arrive in
 * different places and someone who cannot see the screen has to be told where
 * to look.
 */
export type SettingsSurface = 'side-panel' | 'options-page';

export function settingsSurface(): SettingsSurface | null {
  if (isSidePanelSupported()) return 'side-panel';
  if (apis()?.runtime?.openOptionsPage) return 'options-page';
  return null;
}

/**
 * Opens the settings wherever `settingsSurface` says they are. Called straight
 * from the click, for the side panel's sake; the options page does not need a
 * gesture, and does not mind having one.
 */
export async function openSettings(): Promise<void> {
  if (isSidePanelSupported()) {
    await openSidePanel();
    return;
  }
  const open = apis()?.runtime?.openOptionsPage;
  if (!open) throw new Error('The settings cannot be opened in this environment.');
  await open.call(apis()!.runtime);
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
