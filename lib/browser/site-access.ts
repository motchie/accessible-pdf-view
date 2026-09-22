import { browser } from 'wxt/browser';

/**
 * Asking for one site, when reading a document needs it.
 *
 * ## Why this exists at all
 *
 * The extension reads a PDF without any host permission, by having the
 * background fetch it while `activeTab` is live — the user's own gesture
 * standing in for a permission. That works on Chrome. It does not work on
 * Firefox, where `activeTab` covers script injection and the privileged parts
 * of the `tabs` API but **not** a cross-origin fetch, so the fetch comes back
 * as `TypeError: NetworkError` and the Reader is left with a URL it cannot
 * read. The same dead end exists on Chrome for a PDF link right-clicked on a
 * different site, because `activeTab` grants the *active* tab's origin.
 *
 * Neither case can be solved by being cleverer. The browser is saying no, and
 * the only thing that changes its mind is the person in front of it.
 *
 * ## One site, asked for where it failed
 *
 * So this asks — for the single origin that just refused, from the button the
 * user presses in the Reader, with the browser's own prompt doing the asking.
 * Not the blanket http-and-https pattern, though that is what the manifest has
 * to declare before any origin can be requested at runtime: what a document
 * needs is the one site it is on, and what somebody agrees to should be the
 * same thing.
 *
 * Granted access is kept rather than handed back afterwards. A reader who says
 * yes to a site is likely to open another document from it, and asking again
 * every time would train them to click through the prompt without reading it —
 * which is worse than the permission. It stays revocable in the browser's own
 * extensions page, and the offer says so.
 */

/**
 * The match pattern for a URL's origin, or null when there is nothing worth
 * asking for.
 *
 * `https://example.com/*` — the whole site, because a PDF is rarely alone and a
 * path-scoped pattern would ask again for the next document in the same folder.
 * Anything that is not `http` or `https` returns null: a `file:` URL needs a
 * switch on the browser's own extensions page that no extension can request,
 * and a `data:` or `blob:` URL has no site to ask about.
 *
 * **`hostname`, not `host`: a match pattern cannot carry a port.** Both browsers
 * define the host part of a pattern as a host without one, and
 * `http://localhost:8000/*` is not a pattern they will accept — it is rejected,
 * which would have made the request throw rather than prompt. A PDF served from
 * a local web server is exactly the case that finds this, and it is also how
 * this project's own sample document gets opened, since the Reader cannot read
 * `file:`.
 */
export function originPatternFor(url: string): string | null {
  const parsed = parse(url);
  return parsed ? `${parsed.protocol}//${parsed.hostname}/*` : null;
}

/**
 * The site, for saying out loud which one is being asked about.
 *
 * Without the port, for the same reason and one more: the grant covers every
 * port on that host, so naming one would describe something narrower than what
 * is actually being agreed to.
 */
export function hostOf(url: string): string | null {
  return parse(url)?.hostname ?? null;
}

function parse(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

/** `browser` is absent outside an extension, and `permissions` in a browser too
 * old for it. Both mean the same thing here: there is nothing to offer. */
function permissions() {
  return (browser as Partial<typeof browser> | undefined)?.permissions;
}

export function isSiteAccessSupported(): boolean {
  const api = permissions();
  return typeof api?.request === 'function' && typeof api.contains === 'function';
}

/**
 * Whether the extension can already read from this URL's site.
 *
 * Asked before anything is offered, because a button that would open a prompt
 * the browser answers "already granted" to is a button that appears to do
 * nothing — and when access is already there, the failure was something else
 * and pointing at permissions would be a wrong diagnosis.
 */
export async function hasSiteAccess(url: string): Promise<boolean> {
  const pattern = originPatternFor(url);
  const api = permissions();
  if (!pattern || !api?.contains) return false;
  try {
    return await api.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * Asks for it. `false` is the user saying no, which is an answer rather than a
 * failure.
 *
 * Nothing is awaited before the request: a browser only allows
 * `permissions.request()` while the click that led to it is still a live user
 * gesture, and an earlier `await` spends it. That is why the pattern is worked
 * out synchronously above.
 */
export async function requestSiteAccess(url: string): Promise<boolean> {
  const pattern = originPatternFor(url);
  const api = permissions();
  if (!pattern || !api?.request) return false;
  return api.request({ origins: [pattern] });
}
