// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The worker bundle must not touch the DOM.
 *
 * This checks the **built output**, not the source, because the bug it exists
 * for is invisible in the source and invisible to every other test here.
 *
 * What happened: moving Markdown parsing into the worker pulled in
 * `decode-named-character-reference`, which ships a DOM implementation
 * (`document.createElement('i')`, evaluated at module scope) behind the
 * `browser` export condition. Vite produces one build for pages and workers
 * alike and resolves `browser` for both, so the worker died on load with
 * `ReferenceError: document is not defined` and the extension reported
 * the `engine-failed` message — "The PDF analysis engine could not be
 * started" — for every PDF.
 *
 * No unit test could have caught it: Vitest resolves modules with Node's
 * conditions, so it imports the DOM-free implementation and everything passes.
 * Only the bundle the browser actually loads tells the truth — so that is what
 * is inspected.
 *
 * Skipped when there is no build to look at, so `npm test` stays independent of
 * `npm run build`. CI should run the build first.
 */
const outputs = ['.output/chrome-mv3/assets', '.output/firefox-mv3/assets'];

/** Globals a worker does not have. A module-scope reference to any of them is a
 * crash on load, not a runtime branch that might never be taken. */
const DOM_GLOBALS = [
  'document.createElement',
  'document.body',
  'document.head',
  'document.querySelector',
  'window.document',
  'localStorage',
  'sessionStorage',
];

function workerBundles(): Array<{ name: string; source: string }> {
  return outputs
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((name) => name.startsWith('worker-') && name.endsWith('.js'))
        .map((name) => ({
          name: `${dir}/${name}`,
          source: readFileSync(resolve(dir, name), 'utf8'),
        })),
    );
}

const bundles = workerBundles();

describe.skipIf(bundles.length === 0)('the pdf-inspector worker bundle', () => {
  it('was built at all', () => {
    expect(bundles.length).toBeGreaterThan(0);
  });

  it.each(bundles)('$name reaches for no DOM global', ({ source }) => {
    const found = DOM_GLOBALS.filter((global) => source.includes(global));
    expect(found).toEqual([]);
  });

  /** The reason the worker exists: the Markdown parser has to be in it, not on
   * the Reader's thread. If this stops being true the bundle has been split
   * back apart and the 58 ms parse is blocking the UI again. */
  it.each(bundles)('$name carries the Markdown parser', ({ source }) => {
    expect(source).toContain('codeIndented');
  });
});
