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
import { mapFigures } from '../../lib/pdf/document-model';
import { adaptInspectorResult } from '../../lib/pdf/inspector/adapter';
import { READER_PROCESS_OPTIONS, type InspectorRawResult } from '../../lib/pdf/inspector/protocol';
import { classifyPages } from '../../lib/pdf/pdfjs/page-content';
import {
  buildReadings,
  chooseReading,
  decorate,
  documentLanguage,
  pagesNeedingExplanation,
  prepareReading,
  shownHeadingCount,
  type FigureRasterizer,
} from '../../lib/reader/readings';
import { DEFAULT_SETTINGS, type StructureSource } from '../../lib/reader/settings';

/**
 * The document the Reader would show for a PDF, produced under Node.
 *
 * Every step is the Reader's own, from `lib/reader/readings.ts`, called in the
 * order `usePdfAnalysis` calls them: `buildReadings`, `chooseReading`,
 * `prepareReading`, `documentLanguage`, `pagesNeedingExplanation` with
 * `classifyPages`, and `decorate`; heading counts with `shownHeadingCount`.
 * What is left here is only what the hook does through the browser:
 *
 *   - pdf-inspector runs in-process (its WASM core with
 *     `READER_PROCESS_OPTIONS`, lowered by `adaptInspectorResult`) rather than
 *     in the inspector worker, which makes the same two calls.
 *   - PDF.js is the legacy build, which runs under Node, and reads its CMaps,
 *     fonts, image-decoder WASM and ICC profiles from `node_modules/pdfjs-dist`
 *     rather than from the extension's origin — the same files.
 *   - Figure rasterising is replaced by a **stand-in**: there is no canvas
 *     here (the jsdom setup's canvas globals are inert stubs on purpose). Every
 *     figure that was located gets a fixed placeholder URL
 *     (`FIGURE_STAND_IN_URL`), exactly as if the raster had succeeded, because
 *     whether a figure renders as `<img>` or as its placeholder text matters to
 *     the outline. A figure the Reader fails to rasterise is not reproduced.
 *   - `detectLanguage` can only answer null: Chrome's on-device
 *     `LanguageDetector` does not exist under Node, so the script fallback
 *     after it fills the gap. On a machine whose Chrome has the detector model,
 *     the Reader can choose a language this helper does not.
 *   - No cancellation, React state or lazy preparation of the other readings;
 *     only the reading shown first is prepared, as in the hook.
 *
 * The returned document is the settled one, page kinds included — what is on
 * screen a moment after the Reader first shows it.
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

/** `usePdfAnalysis`'s `run()`, through to the page kinds that follow it. */
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
    const { info, raw } = await buildReadings(inspector.document, pdf, { sourceUrl });
    const shown = chooseReading([...raw.keys()], preferred);

    const { document: prepared } = await prepareReading(raw.get(shown)!, pdf, {
      rasterize: standInFigureImages,
    });
    const language = await documentLanguage(prepared, info);
    const needsExplaining = pagesNeedingExplanation(prepared);
    const kinds =
      needsExplaining.length > 0
        ? await classifyPages(pdf, needsExplaining)
        : new Map<number, PageContentKind>();
    const document = decorate(prepared, { info, language, kinds });

    return {
      document,
      structureSource: shown,
      availableSources: [...raw.keys()],
      // As the hook counts them: the shown reading as prepared, the rest raw.
      headingCounts: Object.fromEntries(
        [...raw].map(([origin, reading]) => [
          origin,
          shownHeadingCount(origin === shown ? document : reading, info),
        ]),
      ),
      raw: Object.fromEntries(raw),
      info,
      capabilities: inspector.capabilities,
      markdown: inspector.markdown,
    };
  } finally {
    await loaded.destroy();
  }
}

/**
 * The raster step without the pixels: a figure with a region and no image yet
 * gets an image source, as `materializeFigureImages` gives it one.
 */
const standInFigureImages: FigureRasterizer = async (document) => ({
  document: {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      nodes: mapFigures(page.nodes, (figure, index) =>
        figure.region && !figure.source
          ? { ...figure, source: { kind: 'url', url: `${FIGURE_STAND_IN_URL}-${page.pageNumber}-${index}` } }
          : figure,
      ),
    })),
  },
  revoke: () => {},
});
