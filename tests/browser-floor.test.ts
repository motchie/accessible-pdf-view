// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MINIMUM_CHROME_VERSION, MINIMUM_FIREFOX_VERSION } from '../lib/browser/minimum-versions';

/**
 * The manifest's minimum browser versions against what the shipped PDF.js
 * calls (#23).
 *
 * PDF.js's modern build assumes the newest JavaScript and does not check
 * before calling it, so the oldest browser the extension runs in is set by the
 * newest API that build uses. A PDF.js update that starts calling something
 * newer fails here, instead of quietly breaking fonts or the worker in the
 * browsers between the old floor and the new one.
 *
 * The table is the APIs newer than the floor's neighbours that PDF.js 6 is
 * known to call unguarded, with the first versions from MDN's
 * browser-compat-data. It cannot find an API it does not list: when a PDF.js
 * update lands, look for new ones (its changelog, or a run under an older
 * browser) and add them here. `Float16Array` and `Iterator.prototype.join` are
 * left out on purpose: PDF.js checks for the first and polyfills the second.
 */
const APIS: ReadonlyArray<{ api: string; pattern: RegExp; chrome: number; firefox: number }> = [
  { api: 'Math.sumPrecise', pattern: /Math\.sumPrecise\(/, chrome: 147, firefox: 137 },
  { api: 'Map.prototype.getOrInsertComputed', pattern: /\.getOrInsertComputed\(/, chrome: 145, firefox: 144 },
  { api: 'Uint8Array.prototype.toHex', pattern: /\.toHex\(\)/, chrome: 140, firefox: 133 },
  { api: 'Uint8Array.prototype.toBase64', pattern: /\.toBase64\(\)/, chrome: 140, firefox: 133 },
  { api: 'Uint8Array.fromBase64', pattern: /Uint8Array\.fromBase64\(/, chrome: 140, firefox: 133 },
  { api: 'Promise.try', pattern: /Promise\.try\(/, chrome: 128, firefox: 134 },
];

const root = resolve(import.meta.dirname, '..');
// What ships: the library the Reader imports, and the worker copy-assets copies.
const SHIPPED = ['node_modules/pdfjs-dist/build/pdf.mjs', 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'];

describe('minimum browser versions', () => {
  const source = SHIPPED.map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n');
  const used = APIS.filter(({ pattern }) => pattern.test(source));

  it('finds the newer APIs PDF.js is known to call', () => {
    // If none matched, the patterns have gone stale and the checks below would
    // pass for the wrong reason.
    expect(used.map(({ api }) => api)).toContain('Math.sumPrecise');
  });

  it('declare a Chrome no older than any of them needs', () => {
    for (const { api, chrome } of used) {
      expect(MINIMUM_CHROME_VERSION, `${api} needs Chrome ${chrome}`).toBeGreaterThanOrEqual(chrome);
    }
  });

  it('declare a Firefox no older than any of them needs', () => {
    for (const { api, firefox } of used) {
      expect(MINIMUM_FIREFOX_VERSION, `${api} needs Firefox ${firefox}`).toBeGreaterThanOrEqual(firefox);
    }
  });

  it('are what the newest of them needs, not more', () => {
    // A floor above what anything needs shuts people out for nothing.
    expect(MINIMUM_CHROME_VERSION).toBe(Math.max(...used.map(({ chrome }) => chrome)));
    expect(MINIMUM_FIREFOX_VERSION).toBe(Math.max(128, ...used.map(({ firefox }) => firefox)));
  });
});
