import { createRequire } from 'node:module';
import { defineConfig } from 'wxt';

/**
 * `decode-named-character-reference` decodes `&amp;` and friends for the
 * Markdown parser, and ships two implementations. Its `browser` build is a
 * one-liner that does the work with the DOM:
 *
 *     const element = document.createElement('i')
 *
 * at module scope. That is fine on a page and fatal in a worker, where there is
 * no `document` — and the Markdown parser runs in the worker, so the whole
 * analysis engine failed to start with `ReferenceError: document is not
 * defined`. The package declares a `worker` export condition for exactly this,
 * but a bundler producing one build for both contexts resolves `browser` and
 * uses it everywhere.
 *
 * Resolving through Node's own conditions gives the DOM-free implementation,
 * which is correct in both contexts — the page does not need the DOM to decode
 * an entity either.
 */
const nonDomEntityDecoder = createRequire(import.meta.url).resolve(
  'decode-named-character-reference',
);

/**
 * WXT configuration.
 *
 * Notes on the Manifest V3 constraints this project has to satisfy:
 *
 * - `'wasm-unsafe-eval'` is required before an extension page may instantiate
 *   any WebAssembly module (pdf-inspector, and PDF.js image decoders). It is a
 *   narrow allowance and is NOT `'unsafe-eval'` — no JavaScript eval is
 *   permitted. Both targets need it under V3; the Firefox exception that used
 *   to be here belonged to V2. See the key itself.
 * - Permissions are deliberately minimal and none of the ones granted at
 *   install is a HOST permission: `activeTab` (a temporary grant for the tab or
 *   link the user invoked the extension on — see lib/browser/current-pdf.ts),
 *   `storage` (the reader's own display settings), `contextMenus` (the "open
 *   this PDF link" item), and `sidePanel`, which WXT adds itself for the
 *   side-panel entrypoint.
 * - HOST permissions are OPTIONAL on both targets, and nothing asks for one
 *   until a reader does something that cannot be done without it. There are two
 *   such things.
 *
 *   The first is reading a PDF the browser will not let the extension fetch —
 *   a link on another site, and on Firefox every cross-origin document, because
 *   `activeTab` there does not cover a fetch. One site is requested, at the
 *   moment it failed (lib/browser/site-access.ts).
 *
 *   The second is the setting that sends PDFs to the Reader instead of the
 *   browser's viewer (lib/browser/pdf-handler.ts), which needs every site
 *   because it has to recognise an address before the page loads. Recognising a PDF before the
 *   page loads means standing in front of every navigation, which a browser
 *   only allows for sites an extension can already reach. Declaring it optional
 *   is what keeps it out of the install: the prompt appears when the setting is
 *   switched on and the access is handed back when it is switched off, so
 *   anyone who leaves that setting alone is granting nothing.
 *   `declarativeNetRequestWithHostAccess` rather than `declarativeNetRequest`
 *   for the same reason — it can only act where host access was given.
 */
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  outDir: '.output',

  /**
   * Manifest V3 everywhere, including Firefox, which WXT would otherwise build
   * as V2.
   *
   * Two manifest versions meant two permission models to reason about, and the
   * second one was the one nobody could test. It also cost a feature: the
   * setting that sends PDFs to the Reader is `declarativeNetRequest`, which
   * Firefox offers only under V3, so on V2 it could only be left out.
   *
   * What V3 does *not* change is the thing that made Firefox hard — its
   * `activeTab` still does not cover a cross-origin fetch, which is why
   * lib/browser/site-access.ts exists and why it is not Chromium-only.
   *
   * Firefox's V3 background is an event page rather than a service worker, and
   * WXT emits the right shape for each target from the same entrypoint.
   */
  manifestVersion: 3,

  manifest: ({ browser }) => ({
    name: 'Accessible PDF View',
    // The name is a name and stays in one language. The two strings that are
    // sentences come from `public/_locales/`, which is the one part of this
    // extension that *should* follow the browser's language: nobody expects an
    // extension's store listing to follow a setting inside the extension, and
    // the setting cannot be read before it is installed. The Reader's own
    // interface is the opposite case and has its own catalogue (`lib/i18n/`).
    default_locale: 'en',
    description: '__MSG_extDescription__',
    homepage_url: 'https://accessiblepdfview.org',
    // Minimal permissions. `activeTab` grants a temporary host permission for
    // the tab the user invoked the action on, which is all we need to read the
    // PDF bytes. `storage` holds nothing but the reader's own display settings
    // — font size, line height, theme — which is why it can be `sync`: there is
    // no document content in it. No host_permissions, no <all_urls>.
    permissions: [
      'activeTab',
      'storage',
      'contextMenus',
      // Manifest V3 on both targets now, so both can be offered the setting.
      // Whether a given browser honours the rule is decided at runtime, by
      // asking for the API and then reading the rule back — see
      // lib/browser/pdf-handler.ts.
      'declarativeNetRequestWithHostAccess',
    ],
    action: {
      default_title: '__MSG_actionTitle__',
    },
    // Asked for at the moment a reader needs it, never at install. `*://*/*`
    // and not `<all_urls>`: what is requested is either one site, or the http
    // and https schemes the redirect acts on, and nothing else.
    optional_host_permissions: ['*://*/*'],

    /**
     * The Reader page, reachable as the target of the redirect.
     *
     * Not optional and not cosmetic: a browser refuses to send a navigation to
     * an extension page that is not declared here, and the refusal is
     * `ERR_BLOCKED_BY_CLIENT` — the redirect fires, the page does not load. The
     * `matches` list has to be every site, because the check is against the
     * page the PDF link was clicked on and a link can be anywhere.
     *
     * What it costs: any site can tell this extension is installed, by trying
     * to load that one URL. That is the price of the feature and it is paid
     * whether or not the setting is on, because a manifest cannot be
     * conditional.
     *
     * `use_dynamic_url` is what would take the cost back, and it cannot be used
     * here: it moves the page to an address that changes every session, while
     * the redirect rule persists across sessions with the address baked in. The
     * rule would point at last session's page.
     */
    web_accessible_resources: [{ resources: ['reader.html'], matches: ['*://*/*'] }],

    /**
     * What lets an extension page instantiate WebAssembly — pdf-inspector's
     * core and PDF.js's image decoders, both of which are needed before
     * anything can be shown.
     *
     * Narrow, and NOT `'unsafe-eval'`: no JavaScript eval is permitted either
     * way. It applies to the worker as well as the page, which is where
     * pdf-inspector actually runs.
     *
     * **Both targets, which was not true under Manifest V2.** Firefox V2
     * allowed WebAssembly in an extension page without the keyword and
     * rejected manifests that contained it, so it was emitted for Chromium
     * only. Firefox V3 follows the same rule as Chromium and refuses the
     * instantiation without it — measured, 2026-09-22:
     *
     *   call to WebAssembly.instantiateStreaming() blocked by CSP
     *
     * which surfaced as "this PDF could not be analysed" on every document.
     */
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },

    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'accessible-pdf-view@accessiblepdfview.org',
              /**
               * The floor for everything this manifest relies on.
               *
               * `optional_host_permissions` is the newest of them, and an older
               * Firefox would install this happily and then have no way to
               * grant a site — which is the one thing that makes a PDF readable
               * there. Refusing to install is a better answer than a button
               * that cannot work.
               */
              strict_min_version: '128.0',
              // Accurate, not boilerplate: the extension collects nothing and
              // transmits nothing. If hosted OCR is ever added, this has to
              // change with it.
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),

  vite: () => ({
    worker: {
      // Extension pages run as modules; module workers keep the WASM glue's
      // `import` statements working without an extra bundling step.
      format: 'es',
    },
    resolve: {
      // See the note above nonDomEntityDecoder.
      alias: { 'decode-named-character-reference': nonDomEntityDecoder },
    },
    build: {
      target: 'es2022',
      /**
       * Vite's 500 kB warning measures the wrong thing here.
       *
       * It exists to flag a download users wait on over a network. An extension
       * page is read from local disk, already installed, with its compiled code
       * cached by the browser — there is no transfer to shorten, and the advice
       * it offers (code-splitting to defer work) buys nothing when every part is
       * needed on the same page load.
       *
       * The Reader chunk is ~690 kB, and essentially all of it is two
       * dependencies that must be present before anything can be shown:
       * PDF.js's main-thread API (~450 kB — the Reader opens a document
       * immediately) and React (~140 kB). Everything genuinely deferrable has
       * been moved already: pdf-inspector's WASM core and the Markdown parser
       * both run in the worker, and PDF.js's own worker is a separate file.
       *
       * Raised rather than silenced. If this chunk grows past the new ceiling,
       * something has been added that deserves a look.
       */
      chunkSizeWarningLimit: 800,
    },
  }),
});
