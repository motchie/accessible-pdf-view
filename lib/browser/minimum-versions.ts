/**
 * The oldest browsers the extension runs in, and why.
 *
 * Not chosen: each floor is the newest of the requirements below, and most of
 * them are what PDF.js's modern build (`pdfjs-dist`, which the extension ships)
 * calls without checking first. Below them it does not fail cleanly. With
 * `Math.sumPrecise` missing, embedded fonts fail to load and PDF.js extracts
 * text from a substitute — seen under Node, which lacks it (#23). The other
 * methods are called unguarded too, so the paths that use them would throw;
 * nothing here has been run in a browser that old. Declaring the floor in the
 * manifest turns that into a store that says the extension is not compatible,
 * which is the honest answer.
 *
 * Add a requirement here, not a number in the manifest:
 * `tests/browser-floor.test.ts` checks the PDF.js entries against the calls
 * the shipped build actually makes, so an update that needs a newer browser,
 * or no longer needs an old one, fails there.
 */

export interface BrowserRequirement {
  /** `PDF.js: <API>` for what the bundled PDF.js calls; anything else names its own source. */
  what: string;
  /** First version with it, from MDN's browser-compat-data. Absent: no requirement there. */
  chrome?: number;
  firefox?: number;
  /**
   * Firefox for Android (`firefox_android` in browser-compat-data). Usually
   * the same as `firefox`, which is why it is written out anyway: the one
   * requirement where it differs is the one that would otherwise be missed.
   */
  firefoxAndroid?: number;
}

export const BROWSER_REQUIREMENTS: readonly BrowserRequirement[] = [
  // An older Firefox would install the extension and then have no way to
  // grant a site, which is the one thing that makes a PDF readable there.
  { what: 'manifest: optional_host_permissions', firefox: 128, firefoxAndroid: 128 },
  { what: 'PDF.js: Math.sumPrecise', chrome: 147, firefox: 137, firefoxAndroid: 137 },
  { what: 'PDF.js: Map.prototype.getOrInsertComputed', chrome: 145, firefox: 144, firefoxAndroid: 144 },
  { what: 'PDF.js: Uint8Array.prototype.toHex', chrome: 140, firefox: 133, firefoxAndroid: 133 },
  { what: 'PDF.js: Uint8Array.prototype.toBase64', chrome: 140, firefox: 133, firefoxAndroid: 133 },
  { what: 'PDF.js: Uint8Array.fromBase64', chrome: 140, firefox: 133, firefoxAndroid: 133 },
  { what: 'PDF.js: Promise.try', chrome: 128, firefox: 134, firefoxAndroid: 134 },
  // Declared in the Firefox manifest; Android has had it since 142, two
  // versions after the desktop.
  { what: 'manifest: data_collection_permissions', firefox: 140, firefoxAndroid: 142 },
];

/** Chrome and Edge: today `Math.sumPrecise`, 147. */
export const MINIMUM_CHROME_VERSION = Math.max(...BROWSER_REQUIREMENTS.map((r) => r.chrome ?? 0));

/**
 * Firefox: today `Map.prototype.getOrInsertComputed`, 144. That leaves out the
 * Firefox 140 extended-support release, which matters once the Firefox build
 * is published.
 */
export const MINIMUM_FIREFOX_VERSION = Math.max(...BROWSER_REQUIREMENTS.map((r) => r.firefox ?? 0));

/**
 * Firefox for Android (#72): the same calculation over `firefoxAndroid`. Today
 * also `getOrInsertComputed`, 144 — kept separate so that an API that reaches
 * Android later than the desktop raises this floor and not the desktop's.
 */
export const MINIMUM_FIREFOX_ANDROID_VERSION = Math.max(
  ...BROWSER_REQUIREMENTS.map((r) => r.firefoxAndroid ?? 0),
);
