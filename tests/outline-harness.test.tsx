import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StructureSource } from '../lib/reader/settings';
import { domToOutline } from './helpers/dom-outline';
import { buildMinimalPdf, type MinimalPdfOptions } from './helpers/minimal-pdf';
import { applyKnownGaps, diffOutlines, serializeOutline } from './helpers/outline';
import { KNOWN_GAPS } from './fixtures/word/known-gaps';
import { readPdfAsReader, type ReaderReading } from './helpers/read-pdf';
import { renderReader, type RenderedReader } from './helpers/render-reader';

/**
 * PDF bytes -> the Reader's document -> rendered HTML -> accessibility outline,
 * compared with an outline written by hand.
 *
 * ## Why this runs in jsdom
 *
 * One environment does all of it. pdf-inspector is plain WebAssembly and does
 * not care; PDF.js's legacy build runs under vitest's jsdom environment as
 * long as nothing rasterises, because it still sees Node (`process`) and so
 * reads its CMaps and fonts from disk and uses its in-process fake worker. The
 * canvas globals it touches on import are the inert stubs in
 * `tests/setup/jsdom-canvas.ts`, and the only step that would really draw —
 * `materializeFigureImages` — is replaced by a stand-in in `read-pdf.ts`.
 * Rendering then needs jsdom's `document`, which this environment provides,
 * so there is no hand-built jsdom and no split across files.
 *
 * ## What the expectations here are
 *
 * The PDFs are synthetic (`buildMinimalPdf`), so they exist to prove the
 * harness, not the Reader. Each expected outline was written from what the
 * PDF says and how `renderer.tsx` and `App.tsx` present it — the title as the
 * page's `<h1>`, content headings one level down, the page separator as a
 * paragraph — and then checked against the run. Where the Reader's present
 * output is questionable rather than intended, the comment says so.
 */

let rendered: RenderedReader | null = null;

afterEach(() => {
  rendered?.unmount();
  rendered = null;
});

async function readerOutline(
  bytes: Uint8Array,
  options: { preferred?: StructureSource } = {},
): Promise<{ outline: string; reading: ReaderReading }> {
  const reading = await readPdfAsReader(bytes, options);
  rendered = renderReader(reading, { locale: 'ja' });
  return { outline: serializeOutline(domToOutline(rendered.container)), reading };
}

function expectOutline(actual: string, expected: string): void {
  const diff = diffOutlines(expected, actual);
  expect(diff, `outline differs:\n${diff}\n\nactual:\n${actual}`).toBeNull();
}

const BODY_1 =
  'This report describes the work of the past year in some detail and is long enough to wrap.';
const BODY_2 =
  'The second section continues the account with another sentence of ordinary body text.';

describe('outline harness on synthetic PDFs', () => {
  it('reads an untagged PDF by inference: title once, body, page separator, section', async () => {
    const { outline, reading } = await readerOutline(
      buildMinimalPdf({
        title: 'Annual Report',
        pages: [
          ['Annual Report', BODY_1],
          ['Second Section', BODY_2],
        ],
      }),
    );

    expect(reading.structureSource).toBe('pdf-inspector');
    expect(reading.availableSources).toEqual(['pdf-inspector']);

    // No `lang` on the article: the PDF declares none, and its text is in a
    // script `detectScriptLanguage` does not claim. The document's `lang=ja`
    // is the interface's, which App sets on `<html>`.
    expectOutline(
      outline,
      `
document lang=ja title="Annual Report（リーダー） — Accessible PDF View"
  banner
    heading level=1 "Annual Report"
  main
    region "リーダー"
      article
        # The PDF's first line repeats the title, so the body does not.
        paragraph "${BODY_1}"
        # The page separator is a <p>, so it is in the tree by design.
        paragraph "2 ページ"
        heading level=2 "Second Section"
        paragraph "${BODY_2}"
`,
    );
  }, 30_000);

  it('opens a tagged PDF in the combined reading, with its figures', async () => {
    const { outline, reading } = await readerOutline(
      buildMinimalPdf({
        title: 'Annual Report',
        pages: [['Annual Report', BODY_1]],
        tagged: 'declared',
        figures: [{ alt: 'A blue square on a white page.' }, { alt: '' }, {}],
      }),
    );

    // Every line is tagged `P`, so the tags have no heading; the inferred
    // reading's title heading is what makes a combined reading exist, and the
    // default setting opens it.
    expect(reading.structureSource).toBe('combined');
    expect(reading.availableSources).toEqual(['combined', 'tagged-pdf', 'pdf-inspector']);

    expectOutline(
      outline,
      `
document lang=ja title="Annual Report（リーダー） — Accessible PDF View"
  banner
    heading level=1 "Annual Report"
  main
    region "リーダー"
      article
        paragraph "${BODY_1}"
        figure
          img "A blue square on a white page."
        # The author marked this one decorative. The <img alt=""> leaves the
        # tree, but its <figure> stays, empty — present behaviour, and not
        # obviously the intended one.
        figure
        # No /Alt: the image is silenced and the notice speaks for it.
        figure
          paragraph "画像があります。作成者による代替テキストはありません。"
`,
    );
  }, 30_000);

  it('opens the author\'s tags alone when asked, and points nowhere when the only other heading is the title', async () => {
    const { outline, reading } = await readerOutline(
      buildMinimalPdf({
        title: 'Annual Report',
        pages: [['Annual Report', BODY_1]],
        tagged: 'undeclared',
        figures: [{ alt: 'A blue square on a white page.' }],
      }),
      { preferred: 'tagged-pdf' },
    );

    expect(reading.structureSource).toBe('tagged-pdf');
    expect(reading.availableSources).toEqual(['combined', 'tagged-pdf', 'pdf-inspector']);

    expectOutline(
      outline,
      `
document lang=ja title="Annual Report（リーダー） — Accessible PDF View"
  banner
    heading level=1 "Annual Report"
  main
    region "リーダー"
      # No notice pointing at the combined reading: its one heading is the
      # title, which the Reader does not show again, so there would be nothing
      # there to navigate.
      article
        # Tagged as a paragraph, so it is not the heading the title check
        # drops, and the title is read twice.
        paragraph "Annual Report"
        paragraph "${BODY_1}"
        figure
          img "A blue square on a white page."
`,
    );
  }, 30_000);

  it('reports a wrong expectation as a numbered diff', async () => {
    const { outline } = await readerOutline(
      buildMinimalPdf({ title: 'Annual Report', pages: [['Annual Report', BODY_1]] }),
    );

    const diff = diffOutlines(
      outline.replace(`paragraph "${BODY_1}"`, 'heading level=2 "Summary"'),
      outline,
    );
    expect(diff).toContain('- 7         heading level=2 "Summary"');
    expect(diff).toContain(`+ 7         paragraph "${BODY_1}"`);
  }, 30_000);
});

/**
 * The Word fixture: a document written for this project, exported from Word
 * with structure tags, and an outline written from what the document means.
 * Committed, so never skipped: a missing file is a failure, not a pass.
 */
const wordPdf = resolve(import.meta.dirname, 'fixtures/word/word-basic.pdf');
const wordOutline = resolve(import.meta.dirname, 'fixtures/word/word-basic.outline');

describe('word-basic.pdf', () => {
  it('matches its hand-written outline', async () => {
    const { outline, reading } = await readerOutline(new Uint8Array(await readFile(wordPdf)));

    // Every heading is the author's own, so there is nothing for a combined
    // reading to add and the tags are what open.
    expect(reading.structureSource).toBe('tagged-pdf');
    const { expected, problems } = applyKnownGaps(
      await readFile(wordOutline, 'utf8'),
      outline,
      KNOWN_GAPS['word-basic']!,
    );
    expect(problems).toEqual([]);
    expectOutline(outline, expected);
  }, 60_000);
});
