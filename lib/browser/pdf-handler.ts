import { browser } from 'wxt/browser';
import { READER_PAGE } from './reader-page';

/**
 * Opening PDFs in the Reader instead of the browser's own viewer.
 *
 * ## Why this needs the permission the rest of the extension refuses
 *
 * Everything else here runs on `activeTab`: the user presses the button, the
 * browser hands over that one tab for that one moment, and the grant expires.
 * That is enough because the gesture *is* the request.
 *
 * This has no gesture to hang off. Sending a PDF to the Reader means
 * recognising the address **before the page loads**, which means standing in
 * front of every navigation — and no browser lets anything do that for sites it
 * has no access to. So the feature costs host access to every site, and there
 * is no smaller version of it that works.
 *
 * What it does not cost is the install. The access is declared as an *optional*
 * host permission, which asks nothing of anyone at install time and nothing
 * ever of anyone who leaves this alone; turning the setting on is what raises
 * the browser's own prompt, and turning it off hands the access back. Someone
 * who never opens that section stays exactly where the README says they are.
 *
 * ## Why a declarative rule and not a listener
 *
 * `declarativeNetRequest` states a rule and lets the browser apply it. The
 * extension never sees the request, runs no code per navigation, and learns
 * nothing about what was visited. The alternative — watching navigations and
 * steering the tab afterwards — starts loading the PDF and then abandons it,
 * and puts extension code in the path of every page load. The declarative rule
 * is both the narrower thing to be granted and the cheaper thing to run.
 *
 * The redirect needs one thing from the manifest: the Reader has to be listed
 * in `web_accessible_resources`, or the browser refuses to send a navigation to
 * it and the tab lands on `ERR_BLOCKED_BY_CLIENT`. `wxt.config.ts` says what
 * that costs.
 *
 * ## What it cannot do
 *
 * - **Only addresses ending in `.pdf`.** A rule matches a URL, not a response:
 *   the `Content-Type` that would settle it does not exist yet at the moment
 *   the decision has to be made. A PDF served from `/download?id=42` is not
 *   recognised, and the toolbar button is still how it gets opened.
 * - **Only `http` and `https`.** A file on disk needs "Allow access to file
 *   URLs", a switch on the browser's own extensions page that no extension can
 *   ask for, so a local PDF keeps opening in the browser's viewer.
 * - **Top-level navigations only.** A PDF embedded in a page stays part of that
 *   page.
 * - **The Reader's own link to the original PDF comes back here.** While the
 *   setting is on, that link is a navigation to a `.pdf` address like any
 *   other, and the rule does not know who asked.
 *
 *   `excludedInitiatorDomains` was the obvious way out and does not work:
 *   measured in Chrome on 2026-09-22, a top-level navigation started from an
 *   extension page is not excluded by listing the extension's own id, so the
 *   field was doing nothing and has been removed rather than left to look like
 *   a guarantee. What does work is a session-scoped `allow` rule carrying the
 *   `tabIds` of a tab opened for that one navigation — which is real
 *   machinery, and the loop it buys out of is mild: the Original view already
 *   shows the pages as they are, and switching the setting off restores the
 *   link. Worth building when someone says it bites.
 *
 *   What is not deferred is saying so. The link carries a different note while
 *   this is on (`toolbar.originalOpensHere`), because a new tab holding the
 *   same Reader is indistinguishable from a link that did nothing to anyone who
 *   cannot see it.
 */

/**
 * The host access the rule needs.
 *
 * The http-and-https match pattern below rather than `<all_urls>`, because
 * those are the only schemes this redirects: the access someone is asked to
 * approve should be the access that is actually used.
 */
const PDF_ORIGINS = ['*://*/*'];

/**
 * One rule, one id. Dynamic rules survive restarts and extension updates, so
 * the id is how a later run recognises this rule rather than adding a second.
 */
const RULE_ID = 1;

/**
 * The addresses the rule acts on.
 *
 * `.pdf` has to end the **path**: `[^?#]` cannot cross into a query, so
 * `/report.pdf?t=1` matches and `/viewer?file=report.pdf` does not. The second
 * is a page that displays a PDF rather than a PDF, and redirecting it would
 * send the Reader off to fetch HTML.
 *
 * Nothing here allows for a fragment, because a request never carries one —
 * clicking `…/a.pdf#page=2` puts `GET /a.pdf` on the wire, and the rule matches
 * what is on the wire.
 *
 * Exported so the boundary can be checked without a browser. This pattern is
 * the entire definition of which documents the setting affects.
 */
export const PDF_URL_PATTERN = String.raw`^https?://[^?#]*\.pdf(\?[^#]*)?$`;

/**
 * `browser` is absent outside an extension — in a unit test, and in any page
 * this is reused from later — and the two APIs below are absent in a browser
 * that has no Manifest V3. Reading through either unguarded is a crash rather
 * than a missing feature, so every entry point goes through this.
 */
function apis(): Partial<typeof browser> | undefined {
  return browser as Partial<typeof browser> | undefined;
}

export function isPdfHandlerSupported(): boolean {
  const api = apis();
  return Boolean(api?.declarativeNetRequest?.updateDynamicRules && api?.permissions?.request);
}

/**
 * Whether PDFs are being sent to the Reader right now.
 *
 * Both halves are asked, because either can be undone without this code
 * running: host access can be taken back from the browser's own extensions
 * page, which leaves the rule installed and inert. A control that read the rule
 * alone would report "on" for something that no longer happens.
 */
export async function isPdfHandlerEnabled(): Promise<boolean> {
  const api = apis();
  if (!api?.declarativeNetRequest || !api.permissions) return false;

  const [granted, rules] = await Promise.all([
    api.permissions.contains({ origins: PDF_ORIGINS }),
    api.declarativeNetRequest.getDynamicRules(),
  ]);
  return granted && rules.some((rule) => rule.id === RULE_ID);
}

/**
 * Turns it on, and reports whether the browser agreed.
 *
 * `false` is the user declining the permission prompt. That is an answer, not a
 * failure, and the caller says so plainly rather than dressing it as an error.
 *
 * The request is the first thing that happens and nothing is awaited before it:
 * a browser allows `permissions.request()` only while the click that led to it
 * is still a live user gesture, and an earlier `await` spends it.
 */
export async function enablePdfHandler(): Promise<boolean> {
  const api = apis();
  if (!api?.declarativeNetRequest || !api.permissions || !api.runtime) {
    throw new Error(UNSUPPORTED_HANDLER);
  }

  const granted = await api.permissions.request({ origins: PDF_ORIGINS });
  if (!granted) return false;

  await api.declarativeNetRequest.updateDynamicRules({
    // Removed first, so this is safe to run twice: adding a rule whose id is
    // already registered is an error, and the permission can be granted while
    // the rule is missing.
    removeRuleIds: [RULE_ID],
    addRules: [redirectRule(api.runtime.getURL(READER_PAGE))],
  });
  return true;
}

/**
 * Turns it off and hands the access back.
 *
 * The rule goes first, because stopping the redirect is what was asked for.
 * Giving back the permission second means a failure leaves an extension holding
 * access it does not use, rather than a rule that still fires.
 */
export async function disablePdfHandler(): Promise<void> {
  const api = apis();
  if (!api?.permissions) return;

  await removeRedirectRule();
  await api.permissions.remove({ origins: PDF_ORIGINS });
}

/**
 * Drops the rule without touching the permission.
 *
 * The background calls this when host access is withdrawn from the browser's
 * own extensions page. The rule can do nothing without that access, and one
 * left behind would quietly start working again if the access ever came back
 * for some other reason.
 */
export async function removeRedirectRule(): Promise<void> {
  const api = apis();
  if (!api?.declarativeNetRequest) return;
  await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID] });
}

function redirectRule(readerUrl: string) {
  return {
    id: RULE_ID,
    priority: 1,
    action: {
      type: 'redirect' as const,
      redirect: {
        /**
         * `\0` is the address that matched, inserted exactly as it stands.
         *
         * It goes in the fragment rather than in a query parameter because the
         * substitution cannot encode anything: a PDF at `/a.pdf?x=1&y=2`
         * written into `?src=` would be read back as two more parameters of the
         * Reader's own. A fragment has no structure to collide with —
         * everything after `#src=` is the address — and the address cannot
         * contain a fragment of its own, for the reason above the pattern.
         */
        regexSubstitution: `${readerUrl}#src=\\0`,
      },
    },
    condition: {
      regexFilter: PDF_URL_PATTERN,
      // Explicit, though it is also the default: the default was the other way
      // round before Chrome 118, and links ending `.PDF` are common enough to
      // care about.
      isUrlFilterCaseSensitive: false,
      // Top-level navigations only. A PDF inside an iframe belongs to the page
      // around it, and replacing it with a Reader would break that page.
      //
      // There is deliberately nothing here about who started the navigation:
      // see the note above about `excludedInitiatorDomains`, which looked like
      // it would keep the Reader's own link out and was measured not to.
      resourceTypes: ['main_frame' as const],
    },
  };
}

/** For a thrown error and a console line, not for a panel: the settings section
 * leaves itself out where this is true, so nothing should ever read it. */
export const UNSUPPORTED_HANDLER =
  'This browser cannot hand PDF addresses to an extension. Chrome is required.';
