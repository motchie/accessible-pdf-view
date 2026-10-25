import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import init, { processPdf } from '@firecrawl/pdf-inspector-wasm';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  AccessibleDocument,
  DocumentOrigin,
  PageContentKind,
  PdfCapabilities,
  PdfFileInfo,
} from '../../lib/pdf/document-model';
import { documentToPlainText, mapFigures } from '../../lib/pdf/document-model';
import { combineReadings } from '../../lib/pdf/combined-reading';
import { adaptInspectorResult } from '../../lib/pdf/inspector/adapter';
import { promoteMergedHeadings } from '../../lib/pdf/inspector/heading-promotion';
import { READER_PROCESS_OPTIONS, type InspectorRawResult } from '../../lib/pdf/inspector/protocol';
import { attachFigureRegions } from '../../lib/pdf/pdfjs/figure-regions';
import { detectLanguage, detectScriptLanguage } from '../../lib/pdf/pdfjs/language';
import { readPdfDocumentInfo } from '../../lib/pdf/pdfjs/metadata';
import { classifyPages } from '../../lib/pdf/pdfjs/page-content';
import { recoverEmptyPages } from '../../lib/pdf/pdfjs/recover-pages';
import { coversPageText, extractTaggedDocument, isUsable } from '../../lib/pdf/pdfjs/tagged-adapter';
import { decorate, shownHeadingCount } from '../../lib/reader/decorate';
import { DEFAULT_SETTINGS, type StructureSource } from '../../lib/reader/settings';
import { initialStructureSource } from '../../lib/reader/structure-source';

/**
 * The document the Reader would show for a PDF, produced under Node.
 *
 * This is a copy of the orchestration in `lib/reader/use-pdf-analysis.ts`
 * (`usePdfAnalysis`'s `run()`, and its `enrich` and `decorate`), and it **must
 * be kept in step with it**. The hook cannot be called from here: it is a React
 * hook that owns a Web Worker (`InspectorClient`) and loads PDF.js through
 * `wxt/browser`'s extension URLs. The better fix is to move the hook's pure
 * part — bytes in, readings and the chosen one out — into `lib/` so that the
 * hook and this helper call the same function; until then, a change to the
 * order of steps there that is not repeated here makes these tests check a
 * Reader that no longer exists.
 *
 * Run as the hook runs them:
 *
 *   - pdf-inspector's WASM core, with `READER_PROCESS_OPTIONS`, lowered by
 *     `adaptInspectorResult` — the same two calls the inspector worker makes.
 *   - PDF.js (the legacy build, which runs under Node), `promoteMergedHeadings`,
 *     `readPdfDocumentInfo`, `extractTaggedDocument`, the `isUsable` /
 *     `coversPageText` gate and `combineReadings`, entries in the same order.
 *   - `initialStructureSource` with the Reader's default preference
 *     (`DEFAULT_SETTINGS.structureSource`), or the one passed in.
 *   - From `enrich`: `recoverEmptyPages` and `attachFigureRegions`. Both read
 *     only the PDF — text and the content stream — and need no canvas.
 *   - The language chain: `/Lang`, then the producer's language, then
 *     `detectLanguage`, then `detectScriptLanguage`.
 *   - `decorate` and `shownHeadingCount`, imported rather than copied: the
 *     PDF's own title and language, `info`, and the page content kinds from
 *     `classifyPages`. The hook folds the kinds in after the document is first
 *     shown; this returns the settled document, which is what is on screen a
 *     moment later.
 *
 * Skipped, and why:
 *
 *   - `materializeFigureImages`. It rasterises each located figure onto a
 *     canvas and turns it into a blob URL; there is no canvas here (the jsdom
 *     setup's canvas globals are inert stubs on purpose). What it changes in
 *     the markup is whether a figure renders as `<img>` or as its placeholder
 *     text, and that does matter to the outline — so a **stand-in** takes its
 *     place: every figure `attachFigureRegions` located gets a fixed
 *     placeholder URL (`FIGURE_STAND_IN_URL`), exactly as if the raster had
 *     succeeded. A figure the Reader fails to rasterise (a decode error) would
 *     show its placeholder text instead; that failure is not reproduced.
 *   - `detectLanguage` is called but can only answer null: it needs Chrome's
 *     on-device `LanguageDetector`, which does not exist under Node. The
 *     script fallback after it is what fills the gap here — on a machine whose
 *     Chrome has the detector model, the Reader can choose a language this
 *     helper does not.
 *   - The `AbortSignal` plumbing, React state and the per-source lazy
 *     preparation (`selectSource`): only the reading shown first is prepared,
 *     as in the hook. The others are returned raw, as the hook keeps them.
 *   - The PDF.js asset URLs: the extension serves CMaps, standard fonts, the
 *     image-decoder WASM and ICC profiles from its own origin; here they come
 *     from `node_modules/pdfjs-dist`, which is the same files.
 */

/** What a located figure's `<img src>` is set to in place of a raster. */
export const FIGURE_STAND_IN_URL = 'blob:accessible-pdf-view-test/figure';

export interface ReaderReading {
  /** The document as shown, after enrichment and decoration. */
  document: AccessibleDocument;
  /** Which reading was chosen — the hook's `structureSource`. */
  structureSource: DocumentOrigin;
  /** Every reading offered, in the picker's order — the hook's `availableSources`. */
  availableSources: DocumentOrigin[];
  /** Headings per reading, counted from the raw documents as the hook does. */
  headingCounts: Partial<Record<DocumentOrigin, number>>;
  /** Each reading as its producer left it. */
  raw: Partial<Record<DocumentOrigin, AccessibleDocument>>;
  info: PdfFileInfo;
  capabilities: PdfCapabilities;
  markdown: string | null;
}

export interface ReadPdfOptions {
  /** What `PdfSource.getOriginalUrl()` would return. */
  sourceUrl?: string | null;
  /** The reader's `structureSource` setting. Defaults to the shipped default. */
  preferred?: StructureSource;
}

// From this file rather than the working directory, so a run started elsewhere
// (`vitest --root`, a private suite's runner) finds the same files.
const packageRoot = resolve(import.meta.dirname, '../..');
const pdfjsRoot = resolve(packageRoot, 'node_modules/pdfjs-dist');
const wasmPath = resolve(packageRoot, 'node_modules/@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm');

let inspectorReady: Promise<unknown> | null = null;

function ensureInspector(): Promise<unknown> {
  inspectorReady ??= readFile(wasmPath).then((module) => init({ module_or_path: module }));
  return inspectorReady;
}

type PdfjsLegacy = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: unknown) => { promise: Promise<PDFDocumentProxy>; destroy(): Promise<void> };
  VerbosityLevel: { ERRORS: number };
};

async function loadWithPdfjs(bytes: Uint8Array) {
  const legacy = pdfjs as unknown as PdfjsLegacy;
  legacy.GlobalWorkerOptions.workerSrc = pathToFileURL(
    resolve(pdfjsRoot, 'legacy/build/pdf.worker.mjs'),
  ).href;
  // The same options `loadPdfDocument` passes, pointed at the package's own
  // copies of the assets. Without the CMaps, Japanese text in CID fonts comes
  // back empty — which would make every CJK fixture fail for the wrong reason.
  const task = legacy.getDocument({
    data: bytes,
    cMapUrl: `${resolve(pdfjsRoot, 'cmaps')}/`,
    cMapPacked: true,
    standardFontDataUrl: `${resolve(pdfjsRoot, 'standard_fonts')}/`,
    wasmUrl: `${resolve(pdfjsRoot, 'wasm')}/`,
    iccUrl: `${resolve(pdfjsRoot, 'iccs')}/`,
    verbosity: legacy.VerbosityLevel.ERRORS,
  });
  return { document: await task.promise, destroy: () => task.destroy() };
}

/** Mirrors `usePdfAnalysis`'s `run()` up to the first `ready` state, and the
 * page-kind decoration that follows it. */
export async function readPdfAsReader(
  bytes: Uint8Array,
  options: ReadPdfOptions = {},
): Promise<ReaderReading> {
  const sourceUrl = options.sourceUrl ?? null;
  const preferred = options.preferred ?? DEFAULT_SETTINGS.structureSource;

  // Both producers consume the buffer, so each gets its own copy.
  await ensureInspector();
  const rawResult = processPdf(bytes.slice(0), READER_PROCESS_OPTIONS) as unknown as InspectorRawResult;
  const inspector = adaptInspectorResult(rawResult, sourceUrl);

  const loaded = await loadWithPdfjs(bytes.slice(0));
  try {
    const pdf = loaded.document;

    const inferred = await promoteMergedHeadings(inspector.document, pdf);
    const info = await readPdfDocumentInfo(pdf);

    const entries = new Map<DocumentOrigin, AccessibleDocument>();
    if (info.isTagged || info.hasStructureTree) {
      const tagged = await extractTaggedDocument(pdf, { sourceUrl, info });
      if (isUsable(tagged) && (info.isTagged || coversPageText(tagged!))) {
        const combined = combineReadings(
          tagged!.document,
          inferred,
          info.title ?? tagged!.document.metadata.title,
        );
        if (combined) entries.set('combined', combined);
        entries.set('tagged-pdf', tagged!.document);
      }
    }
    entries.set('pdf-inspector', inferred);

    const shown = initialStructureSource([...entries.keys()], preferred) ?? 'pdf-inspector';
    const enriched = await enrich(entries.get(shown)!, pdf);

    const sample = documentToPlainText(enriched).slice(0, 4000);
    const language =
      info.language ??
      enriched.metadata.language ??
      (await detectLanguage(sample)) ??
      detectScriptLanguage(sample) ??
      undefined;

    const needsExplaining = enriched.pages
      .filter((page) => page.status === 'requires-ocr' && !page.ocrCauses?.length)
      .map((page) => page.pageNumber);
    const kinds =
      needsExplaining.length > 0
        ? await classifyPages(pdf, needsExplaining)
        : new Map<number, PageContentKind>();

    const document = decorate(enriched, { info, language, kinds });
    return {
      document,
      structureSource: shown,
      availableSources: [...entries.keys()],
      // As the hook counts them: the shown reading as prepared, the rest raw.
      headingCounts: Object.fromEntries(
        [...entries].map(([origin, raw]) => [
          origin,
          shownHeadingCount(origin === shown ? document : raw, info),
        ]),
      ),
      raw: Object.fromEntries(entries),
      info,
      capabilities: inspector.capabilities,
      markdown: inspector.markdown,
    };
  } finally {
    await loaded.destroy();
  }
}

/** The hook's `enrich`, with the raster step replaced by its stand-in. */
async function enrich(raw: AccessibleDocument, pdf: PDFDocumentProxy): Promise<AccessibleDocument> {
  const complete = await recoverEmptyPages(raw, pdf);
  const positioned = await attachFigureRegions(complete, pdf);
  return standInFigureImages(positioned);
}

/**
 * What `materializeFigureImages` does to the tree, without the pixels: a figure
 * with a region and no image yet gets an image source.
 */
function standInFigureImages(document: AccessibleDocument): AccessibleDocument {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      nodes: mapFigures(page.nodes, (figure, index) =>
        figure.region && !figure.source
          ? { ...figure, source: { kind: 'url', url: `${FIGURE_STAND_IN_URL}-${page.pageNumber}-${index}` } }
          : figure,
      ),
    })),
  };
}
