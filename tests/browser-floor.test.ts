// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BROWSER_REQUIREMENTS,
  MINIMUM_CHROME_VERSION,
  MINIMUM_FIREFOX_VERSION,
} from '../lib/browser/minimum-versions';

/**
 * The browser floor against what the shipped PDF.js calls (#23).
 *
 * PDF.js's modern build assumes the newest JavaScript and does not check
 * before calling it, so the floor follows the newest API it uses. The
 * requirements in `lib/browser/minimum-versions.ts` name those APIs; this
 * checks that the list and the shipped code agree in both directions. A PDF.js
 * update that starts calling one of these, or stops, fails here.
 *
 * What it cannot see is an API that has no pattern below. When PDF.js is
 * updated, look for new ones (its changelog, or a run in an older browser),
 * and add both a requirement and a pattern. `Float16Array` and
 * `Iterator.prototype.join` are left out on purpose: PDF.js checks for the
 * first and polyfills the second.
 */
const PATTERNS: Record<string, RegExp> = {
  'PDF.js: Math.sumPrecise': /Math\.sumPrecise\b/,
  'PDF.js: Map.prototype.getOrInsertComputed': /\bgetOrInsertComputed\b/,
  'PDF.js: Uint8Array.prototype.toHex': /\.toHex\b/,
  'PDF.js: Uint8Array.prototype.toBase64': /\.toBase64\b/,
  'PDF.js: Uint8Array.fromBase64': /\bfromBase64\b/,
  'PDF.js: Promise.try': /Promise\.try\b/,
};

const root = resolve(import.meta.dirname, '..');
// What ships: the library the Reader imports, and the worker copy-assets copies.
const SHIPPED = ['node_modules/pdfjs-dist/build/pdf.mjs', 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'];

describe('the browser floor', () => {
  const source = SHIPPED.map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n');
  const pdfjsRequirements = BROWSER_REQUIREMENTS.filter(({ what }) => what.startsWith('PDF.js: '));

  it('has a pattern for every PDF.js requirement, and a requirement for every pattern', () => {
    expect(pdfjsRequirements.map(({ what }) => what).sort()).toEqual(Object.keys(PATTERNS).sort());
  });

  it('lists exactly the newer APIs the shipped PDF.js calls', () => {
    // Both ways: a listed API PDF.js no longer calls holds the floor up for
    // nothing, and a pattern that stopped matching would quietly drop out.
    const missing = pdfjsRequirements.filter(({ what }) => !PATTERNS[what]!.test(source)).map(({ what }) => what);
    expect(missing, 'listed, but not found in the shipped PDF.js').toEqual([]);
  });

  it('is what the README tells people', () => {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
    expect(readme).toContain(`Chrome ${MINIMUM_CHROME_VERSION} or later`);
    expect(readme).toContain(`Firefox ${MINIMUM_FIREFOX_VERSION} or later`);
  });
});
