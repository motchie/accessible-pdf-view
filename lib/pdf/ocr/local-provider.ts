import { PdfError } from '../errors';
import type { OcrInput, OcrOptions, OcrProvider, OcrResult } from './provider';

/**
 * In-browser OCR. Not shipped in the MVP — this is the wired-up seam.
 *
 * Evaluation of Tesseract.js (the obvious candidate) against the criteria in
 * the project brief, as of this implementation:
 *
 *   License        Apache-2.0. Compatible with shipping inside an MIT project.
 *   Japanese       Supported (`jpn`, `jpn_vert`), but vertical writing and
 *                  ruby-annotated text — both common in Japanese documents —
 *                  are where accuracy degrades most.
 *   WASM size      `tesseract.js-core` is several MB, and language data is a
 *                  further ~2 MB (`fast`) to ~15 MB (`best`) *per language*.
 *                  Bundled, that roughly doubles this extension's size.
 *   Extension CSP  Workable but not out of the box. Tesseract.js defaults to
 *                  loading its worker, core and language data from a CDN;
 *                  `script-src 'self'` blocks the worker and core. Everything
 *                  must be vendored and `workerPath`, `corePath` and `langPath`
 *                  pointed at `browser.runtime.getURL(...)`.
 *   Performance    Seconds per page at 300 DPI on a typical laptop; a 20-page
 *                  scan is a minute-plus of work.
 *   Accuracy       For clean scans of horizontal Japanese text it is usable.
 *                  For the photographed and low-contrast material that drives
 *                  people to this extension in the first place, it is not
 *                  reliable enough to present as the document's text.
 *
 * The conclusion is not "never"; it is that shipping it silently, as though its
 * output were the document, would misrepresent the document to exactly the
 * users who cannot check it against the original. When it lands it will be
 * opt-in and labelled experimental — which is why `experimental` is on the
 * interface rather than a comment.
 *
 * To implement: vendor the assets in scripts/copy-assets.mjs, create the worker
 * with the local paths, and map Tesseract's block output onto `OcrBlock`.
 * Tesseract reports paragraph and line geometry, so `bbox` can be populated and
 * simple heading/paragraph separation inferred from font height — nothing else
 * in the pipeline needs to change.
 */
export class LocalOcrProvider implements OcrProvider {
  readonly id = 'local';
  readonly displayName = 'Local OCR (experimental, not shipped)';
  readonly sendsDataExternally = false;
  readonly experimental = true;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async analyze(_input: OcrInput, _options?: OcrOptions): Promise<OcrResult> {
    throw new PdfError('ocr-failed', 'ocr-local-unavailable');
  }
}
