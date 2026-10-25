/**
 * The oldest browsers the extension runs in, and why.
 *
 * Not chosen: they are what PDF.js's modern build (`pdfjs-dist`, which the
 * extension ships) calls without checking first. Below them it does not fail
 * cleanly. With `Math.sumPrecise` missing, every embedded font fails to load
 * and PDF.js falls back to a substitute, which changes the text it extracts;
 * with `Map.prototype.getOrInsertComputed` missing, the worker throws.
 * Declaring the floor in the manifest turns that into a store that says the
 * extension is not compatible, which is the honest answer (#23).
 *
 * `tests/browser-floor.test.ts` checks these against the newer APIs the
 * shipped PDF.js uses, so a PDF.js update that needs a newer browser fails
 * there rather than in someone's Reader.
 */

/** `Math.sumPrecise` arrived in Chrome 147 (and Edge 147). */
export const MINIMUM_CHROME_VERSION = 147;

/**
 * `Map.prototype.getOrInsertComputed` arrived in Firefox 144. That leaves out
 * the Firefox 140 extended-support release, which matters once the Firefox
 * build is published.
 */
export const MINIMUM_FIREFOX_VERSION = 144;
