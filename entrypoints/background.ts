import { browser } from 'wxt/browser';
import {
  PDF_LINK_PATTERNS,
  buildReaderUrl,
  openReaderForTab,
  openReaderForUrl,
} from '../lib/browser/current-pdf';
import { clearHandoffs } from '../lib/browser/handoff';
import { removeRedirectRule } from '../lib/browser/pdf-handler';
import { isPdfError } from '../lib/pdf/errors';

/**
 * The background entrypoint.
 *
 * Intentionally thin, and the *only* thing in the project that knows how the
 * Reader gets launched. There are two ways now — the toolbar button, and the
 * context-menu item on a link to a PDF — and both funnel into the same two
 * functions. A future `application/pdf` MIME-handler entrypoint would sit
 * beside them and reuse everything downstream — PdfSource, the parser, the
 * Document Model, the Reader — unchanged.
 *
 * Both gestures grant `activeTab`, which is why neither needs a host
 * permission: the toolbar action and executing a context-menu item are both on
 * Chrome's list of gestures that do.
 */
/**
 * The toolbar button.
 *
 * `action` on both targets now: the build is Manifest V3 everywhere, and
 * `browserAction` was only ever the V2 spelling of this. The check remains
 * because the entrypoint is also loaded by tooling that has no extension APIs
 * at all, where a bare property access is a crash rather than a diagnosis.
 */
function actionApi(): typeof browser.action {
  const api = browser.action;
  if (!api) throw new Error('No toolbar action API is available in this browser.');
  return api;
}

/** Stable across restarts, so the menu can be replaced rather than duplicated. */
const OPEN_LINK_MENU_ID = 'apv-open-pdf-link';

export default defineBackground(() => {
  actionApi().onClicked.addListener(async (tab) => {
    try {
      await openReaderForTab(tab);
    } catch (error) {
      // The tab is not something we can read. Open the Reader anyway, so the
      // explanation arrives in an accessible page rather than disappearing into
      // the service worker console where nobody will find it.
      await browser.tabs.create({ url: errorReaderUrl(error), active: true });
    }
  });

  // PDF bytes parked for a handoff must not outlive the browsing session.
  browser.runtime.onStartup.addListener(() => {
    void clearHandoffs();
  });
  browser.runtime.onInstalled.addListener(() => {
    void clearHandoffs();
    void installLinkMenu();
  });

  // Host access for the PDF redirect can be taken back from the browser's own
  // extensions page, and the rule does not go with it — it stays installed and
  // inert. Dropping it keeps the settings panel's answer and the browser's
  // behaviour the same thing, and stops the rule coming back to life if that
  // access is ever granted again for another reason.
  browser.permissions?.onRemoved.addListener(() => {
    void removeRedirectRule();
  });

  // Firefox names this API `menus` and also provides `contextMenus`; a browser
  // with neither simply does not get the menu item, and the toolbar button is
  // unaffected.
  browser.contextMenus?.onClicked.addListener(async (info) => {
    if (info.menuItemId !== OPEN_LINK_MENU_ID || !info.linkUrl) return;
    try {
      await openReaderForUrl(info.linkUrl);
    } catch (error) {
      await browser.tabs.create({ url: errorReaderUrl(error), active: true });
    }
  });
});

/**
 * Created on install rather than on every worker start: menu items persist, and
 * creating one that already exists is an error. `removeAll` first so an updated
 * title or pattern list replaces the old item instead of failing beside it.
 */
async function installLinkMenu(): Promise<void> {
  const menus = browser.contextMenus;
  if (!menus) return;

  await menus.removeAll();
  menus.create({
    id: OPEN_LINK_MENU_ID,
    // `browser.i18n`, not the Reader's catalogue: the browser draws this label
    // in its own surface, before any Reader exists to hold a setting.
    title: browser.i18n.getMessage('contextMenuTitle'),
    contexts: ['link'],
    targetUrlPatterns: [...PDF_LINK_PATTERNS],
  });
}

function errorReaderUrl(error: unknown): string {
  const url = new URL(buildReaderUrl({ sourceUrl: '', handoffId: null }));
  url.searchParams.delete('src');

  if (isPdfError(error)) {
    url.searchParams.set('error', error.code);
    url.searchParams.set('errorKey', error.messageKey);
    if (error.detail) url.searchParams.set('errorDetail', error.detail);
  } else {
    url.searchParams.set('error', 'no-source');
    url.searchParams.set('errorKey', 'unknown');
  }

  return url.toString();
}
