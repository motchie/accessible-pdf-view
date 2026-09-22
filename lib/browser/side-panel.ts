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
type MaybeApis = { sidePanel?: SidePanelApi; sidebarAction?: SidebarActionApi } | undefined;

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
