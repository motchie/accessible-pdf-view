import { browser } from 'wxt/browser';
import { PdfError } from '../pdf/errors';
import { createHandoffId, isHandoffSupported, putHandoff } from './handoff';
import { READER_PAGE } from './reader-page';

/**
 * Everything the background service worker does to turn "the user clicked the
 * action while looking at a PDF" into "the Reader tab has the bytes".
 *
 * The permission story, which is the reason this lives in the background and
 * not in the Reader:
 *
 *   `activeTab` grants a temporary host permission for the tab the action was
 *   invoked on. That grant lets the *background worker* fetch the tab's URL
 *   cross-origin, and it expires when the user navigates away. The Reader tab
 *   has no such grant, which is why it cannot fetch an arbitrary PDF itself.
 *   So the fetch happens here, immediately, while the grant is live.
 *
 * This flow asks for no host permission at all — `activeTab` is the whole of
 * it. The one feature that needs more is the redirect in `pdf-handler.ts`, and
 * it is optional, off by default, and nothing here depends on it.
 */

export interface OpenReaderResult {
  readerTabId: number | undefined;
  handoffId: string | null;
}

/**
 * Best-effort check that a tab is showing a PDF.
 *
 * Chrome's built-in viewer keeps the PDF's own URL in `tab.url`, but that URL
 * frequently has no `.pdf` extension, so this cannot be strict: when in doubt
 * we proceed and let the parser decide. It exists only to give an early, clear
 * message for the obviously-wrong cases (a normal web page, the Chrome Web
 * Store, `chrome://` pages).
 */
export function looksLikePdfUrl(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Pages the extension can never read, regardless of permissions.
  if (['chrome:', 'edge:', 'about:', 'chrome-extension:', 'moz-extension:'].includes(parsed.protocol)) {
    return false;
  }
  return true;
}

/**
 * Link targets the context-menu item is offered on.
 *
 * Deliberately loose. Chrome's own documentation does not state whether a match
 * pattern's path is tested against the query string as well, or whether it is
 * case-sensitive, so nothing here depends on either: every pattern ends in a
 * wildcard, which matches `?download=1` and `#page=3` whichever way that works.
 *
 * The cost of being loose is that `/a.pdfx` also gets the menu item; the cost
 * of being strict would be a link that plainly ends in `.pdf` and does not.
 * Offering it once too often is recoverable — the Reader says what went wrong —
 * and a missing menu item just looks broken.
 *
 * Unusual casing (`.Pdf`) is not covered, because the alternative is
 * enumerating every combination. The toolbar button still opens such a file.
 */
export const PDF_LINK_PATTERNS: readonly string[] = [
  '*://*/*.pdf*',
  '*://*/*.PDF*',
];

export function assertOpenableTab(tab: { url?: string }): string {
  if (!tab.url) {
    throw new PdfError('no-source', 'tab-url-unavailable');
  }
  if (!looksLikePdfUrl(tab.url)) {
    throw new PdfError(
      'unsupported-scheme',
      'unsupported-page',
    );
  }
  return tab.url;
}

/**
 * Fetches the PDF under the live `activeTab` grant and parks it for the Reader.
 * Returns null when the fetch did not succeed — the Reader will then try the
 * URL directly and report a precise error if that fails too.
 */
export async function prefetchPdf(url: string): Promise<string | null> {
  if (!isHandoffSupported()) {
    notPrefetched('the Cache API is not available in this browser');
    return null;
  }

  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include' });
  } catch (cause) {
    notPrefetched('the fetch was refused, so there is no host access here', cause);
    return null;
  }

  if (!response.ok) {
    notPrefetched(`the server answered ${response.status}`);
    return null;
  }

  try {
    const handoffId = createHandoffId();
    await putHandoff(handoffId, response);
    return handoffId;
  } catch (cause) {
    notPrefetched('the bytes could not be parked for the Reader', cause);
    return null;
  }
}

/**
 * Why the prefetch did not happen.
 *
 * **The failure is still swallowed**, and deliberately: this is an
 * optimisation, and the Reader gives a far better account of what went wrong
 * than the background can, because it knows which fallbacks it has already
 * tried. What was swallowed along with it was the *reason* — and from the
 * outside all four of these look the same, because the Reader then fetches the
 * URL itself and, for a cross-origin document, reports a CORS failure. That
 * message names the last thing that failed rather than the first.
 *
 * Which matters most where none of this is verified. Firefox builds as Manifest
 * V2, where the background is a page rather than a service worker and
 * `activeTab` is Firefox's own implementation of the same idea. A prefetch that
 * does not happen there is either of the first two lines above, and they want
 * opposite fixes.
 */
function notPrefetched(reason: string, cause?: unknown): void {
  console.info(
    `[accessible-pdf-view] the PDF was not prefetched: ${reason}. ` +
      'The Reader will try to fetch it itself.',
    cause ?? '',
  );
}

export function buildReaderUrl(params: {
  sourceUrl: string;
  handoffId: string | null;
}): string {
  const url = new URL(browser.runtime.getURL(READER_PAGE));
  url.searchParams.set('src', params.sourceUrl);
  if (params.handoffId) url.searchParams.set('handoff', params.handoffId);
  return url.toString();
}

/** Opens the Reader in a new tab next to the PDF it came from. */
export async function openReaderForTab(tab: {
  id?: number;
  url?: string;
  index?: number;
  windowId?: number;
}): Promise<OpenReaderResult> {
  return openReaderForUrl(assertOpenableTab(tab), tab);
}

/**
 * Opens the Reader for a URL that is not the current tab's — a link the user
 * right-clicked.
 *
 * The permission story is the same shape and one step weaker. Executing a
 * context-menu item is one of the gestures that grant `activeTab`, so this
 * needs no host permission either. But `activeTab` grants the *active tab's*
 * origin, and a PDF link frequently points somewhere else — so the prefetch
 * here is more likely to fail than the toolbar button's.
 *
 * That is survivable rather than fatal, because the fallback already exists and
 * is already exercised: `prefetchPdf` returns null, the Reader receives the URL
 * alone and fetches it itself, which works for same-origin and CORS-enabled
 * sources and produces a precise error when it does not. Nothing new had to be
 * built for the failure path, and nothing pretends the fetch succeeded.
 */
export async function openReaderForUrl(
  sourceUrl: string,
  near: { index?: number; windowId?: number } = {},
): Promise<OpenReaderResult> {
  assertOpenableUrl(sourceUrl);
  const handoffId = await prefetchPdf(sourceUrl);

  const created = await browser.tabs.create({
    url: buildReaderUrl({ sourceUrl, handoffId }),
    index: near.index === undefined ? undefined : near.index + 1,
    windowId: near.windowId,
    active: true,
  });

  return { readerTabId: created.id, handoffId };
}

/** Throws the same explanation `assertOpenableTab` gives, for a bare URL. */
export function assertOpenableUrl(url: string): string {
  return assertOpenableTab({ url });
}
