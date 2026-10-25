import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  AccessibleDocument,
  DocumentOrigin,
  PageContentKind,
  PdfCapabilities,
  PdfFileInfo,
} from '../pdf/document-model';
import { PdfError, isPdfError } from '../pdf/errors';
import { InspectorClient } from '../pdf/inspector/client';
import { READER_PROCESS_OPTIONS } from '../pdf/inspector/protocol';
import { classifyPages } from '../pdf/pdfjs/page-content';
import { loadPdfDocument } from '../pdf/pdfjs/renderer';
import type { PdfSource } from '../pdf/source/pdf-source';
import type { StructureSource } from './settings';
import {
  buildReadings,
  chooseReading,
  decorate,
  documentLanguage,
  pagesNeedingExplanation,
  prepareReading,
  shownHeadingCount,
} from './readings';

/**
 * The Reader's load-and-analyse state machine.
 *
 * Two producers run against the same bytes:
 *
 *   - pdf-inspector infers structure from layout. Always run, because it
 *     produces the Markdown view and is the fallback for untagged documents.
 *   - PDF.js reads the author's own structure tree, when the PDF is tagged.
 *
 * When a tagged extraction yields something usable it wins by default, because
 * inferred structure is a guess and tagged structure is what the author
 * actually said. **Both are kept**, and the reader can be switched between
 * them: the tag tree is the better answer and not always the right one, and
 * seeing the same document read both ways is how you find out which.
 *
 * A third reading is assembled from the two when it can be — the tagged
 * document with the headings its tags lack, each verified against the page and
 * labelled as inferred (`combined-reading.ts`). It is what the default setting
 * asks for; on the many documents that have no such reading, the author's
 * answer is what the default gets.
 * `structureSource` records which one is on screen, so the UI can be honest
 * about it rather than presenting them as equivalent.
 *
 * ## Why the second document is prepared late
 *
 * Neither producer positions its figures; `attachFigureRegions` and
 * `materializeFigureImages` do, by walking each page's content stream and
 * rasterising what they find. That is the expensive half of the load. Doing it
 * twice up front would double the wait for every reader, to serve a switch most
 * will never make — so the other document is prepared the first time it is
 * asked for, and kept once it has been.
 *
 * ## What crosses the switch and what does not
 *
 * Each document keeps whatever has been done to it: generated descriptions and
 * OCR results stay with the document they were applied to, and switching back
 * finds them again. They do not cross, because the two documents do not agree
 * on what a figure is — pdf-inspector's Nth image and the tag tree's Nth
 * `Figure` are frequently not the same thing, and quietly moving a description
 * between them would attach author-checked text to the wrong picture.
 */

export type AnalysisPhase = 'idle' | 'fetching' | 'analyzing' | 'ready' | 'error';

export interface AnalysisState {
  phase: AnalysisPhase;
  document: AccessibleDocument | null;
  capabilities: PdfCapabilities | null;
  markdown: string | null;
  info: PdfFileInfo | null;
  /** Which producer supplied the structure being rendered. */
  structureSource: DocumentOrigin | null;
  /** Every producer that yielded a usable document for this PDF, best first. */
  availableSources: DocumentOrigin[];
  /** Set while a producer's document is being prepared for its first showing. */
  preparingSource: DocumentOrigin | null;
  /**
   * How many headings each reading offers, including ones not yet prepared.
   *
   * Counted from the raw documents, which exist for every producer from the
   * start — so the Reader can say "this reading has none and the other has
   * three" without paying to prepare the other one.
   */
  headingCounts: Partial<Record<DocumentOrigin, number>>;
  /** A failed switch. Not `error`: the document on screen is still good. */
  switchError: string | null;
  /** Kept for Original mode and OCR page rasterisation. */
  pdf: PDFDocumentProxy | null;
  error: PdfError | null;
}

const INITIAL: AnalysisState = {
  phase: 'idle',
  document: null,
  capabilities: null,
  markdown: null,
  info: null,
  structureSource: null,
  availableSources: [],
  preparingSource: null,
  headingCounts: {},
  switchError: null,
  pdf: null,
  error: null,
};

/** One producer's document, and what has been done to it so far. */
interface SourceEntry {
  /** As the producer left it: no figure regions, no images, no metadata. */
  raw: AccessibleDocument;
  /** Prepared and possibly edited since. Null until first shown. */
  document: AccessibleDocument | null;
  /** Frees the object URLs of this document's figure images. */
  revoke: (() => void) | null;
}

/** What a switch needs, and what the effect's closure would otherwise keep. */
interface Runtime {
  controller: AbortController;
  pdf: PDFDocumentProxy;
  entries: Map<DocumentOrigin, SourceEntry>;
  info: PdfFileInfo;
  /** Resolved once, from whichever document was shown first — it is a property
   * of the PDF, not of the producer that read it. */
  language: string | undefined;
  /** Same: why a page has no text does not depend on who failed to read it. */
  kinds: Map<number, PageContentKind>;
}

export interface AnalysisOptions {
  /**
   * Which reading to open with, from the reader's own settings.
   *
   * Read at the moment the choice is made, not when the hook mounts. The
   * settings arrive from storage a few milliseconds in, and the choice is made
   * only after both producers and the tag extraction have finished — seconds
   * later. Holding it in a ref rather than in the effect's dependencies is what
   * keeps a late setting from restarting the whole analysis.
   */
  preferred?: StructureSource;
}

export function usePdfAnalysis(
  source: PdfSource | null,
  options: AnalysisOptions = {},
): AnalysisState & {
  retry: () => void;
  /** Replaces the rendered document — used when figure descriptions are
   * generated after the initial load. */
  replaceDocument: (document: AccessibleDocument) => void;
  /** Shows another producer's reading of the same PDF. */
  selectSource: (origin: DocumentOrigin) => void;
} {
  const [state, setState] = useState<AnalysisState>(INITIAL);
  const [attempt, setAttempt] = useState(0);
  const clientRef = useRef<InspectorClient | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const shownRef = useRef<DocumentOrigin | null>(null);
  const preferredRef = useRef<StructureSource>(options.preferred ?? 'tagged-pdf');
  preferredRef.current = options.preferred ?? 'tagged-pdf';
  /** The switch the user asked for last. A slow preparation that finishes after
   * the user has moved on must not drag the reader back to it. */
  const wantedRef = useRef<DocumentOrigin | null>(null);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!source) return;

    const controller = new AbortController();
    let cancelled = false;
    let loaded: Awaited<ReturnType<typeof loadPdfDocument>> | null = null;
    const client = new InspectorClient();
    clientRef.current = client;

    async function run(activeSource: PdfSource) {
      setState({ ...INITIAL, phase: 'fetching' });

      try {
        const bytes = await activeSource.getBytes();
        if (cancelled) return;

        setState((previous) => ({ ...previous, phase: 'analyzing' }));
        const sourceUrl = activeSource.getOriginalUrl();

        // Both producers consume the buffer, so each gets its own copy.
        const inspectorPromise = client.analyze(bytes.slice(0), {
          ...READER_PROCESS_OPTIONS,
          sourceUrl,
          signal: controller.signal,
        });
        const pdfjsPromise = loadPdfDocument(bytes.slice(0));

        // The two run concurrently: pdf-inspector is a synchronous WASM call in
        // a worker, PDF.js is its own worker, and neither waits on the other.
        const [inspector, pdfDocument] = await Promise.all([inspectorPromise, pdfjsPromise]);
        if (cancelled) {
          void pdfDocument.destroy();
          return;
        }
        loaded = pdfDocument;

        const { info, raw } = await buildReadings(inspector.document, pdfDocument.document, {
          sourceUrl,
          signal: controller.signal,
        });
        if (cancelled) return;

        const entries = new Map<DocumentOrigin, SourceEntry>(
          [...raw].map(([origin, document]) => [origin, { raw: document, document: null, revoke: null }]),
        );

        const runtime: Runtime = {
          controller,
          pdf: pdfDocument.document,
          entries,
          info,
          language: undefined,
          kinds: new Map(),
        };
        runtimeRef.current = runtime;

        // The reader's setting decides, where there is a decision to make. The
        // other reading stays raw until asked for.
        const shown = chooseReading([...entries.keys()], preferredRef.current);
        wantedRef.current = shown;
        const entry = entries.get(shown)!;

        const enriched = await enrich(entry.raw, runtime);
        if (cancelled) {
          enriched.revoke();
          return;
        }
        entry.revoke = enriched.revoke;

        runtime.language = await documentLanguage(enriched.document, info, {
          signal: controller.signal,
        });
        if (cancelled) return;

        entry.document = decorate(enriched.document, runtime);
        shownRef.current = shown;

        setState({
          phase: 'ready',
          document: entry.document,
          capabilities: inspector.capabilities,
          markdown: inspector.markdown,
          info,
          structureSource: shown,
          availableSources: [...entries.keys()],
          preparingSource: null,
          headingCounts: Object.fromEntries(
            // The shown reading is counted as prepared: recovering empty pages
            // can change which heading comes first, and so whether it is the
            // title. The others are counted raw until they are prepared.
            [...entries].map(([origin, value]) => [
              origin,
              shownHeadingCount(value.document ?? value.raw, info),
            ]),
          ),
          switchError: null,
          pdf: pdfDocument.document,
          error: null,
        });

        // Why each text-less page has no text — after the document is on
        // screen, never before it.
        //
        // This walks a page's content stream, which on a scan means waiting for
        // its images to decode. On a 27-page deck that is seconds, and holding
        // the whole document back for one sentence of wording per page would be
        // a bad trade. The notices sharpen a moment later instead; until then
        // each page says only what is certain.
        // Only the pages the producer did not explain. pdf-inspector reports a
        // cause per page and this used to be computed from scratch regardless:
        // on the 29-page scanned deck that is 26 content-stream walks for an
        // answer already sitting in the result.
        const needsExplaining = pagesNeedingExplanation(entry.document);

        if (needsExplaining.length > 0) {
          const kinds = await classifyPages(pdfDocument.document, needsExplaining, {
            signal: controller.signal,
          });
          if (cancelled || kinds.size === 0) return;

          runtime.kinds = kinds;
          // Folded into every prepared document, including one the user may
          // have switched to meanwhile, and into any user edits made since —
          // `decorate` maps over what is there now rather than over a snapshot.
          for (const prepared of runtime.entries.values()) {
            if (prepared.document) prepared.document = decorate(prepared.document, runtime);
          }
          setState((previous) => {
            if (previous.phase !== 'ready' || !previous.structureSource) return previous;
            const current = runtime.entries.get(previous.structureSource)?.document;
            return current ? { ...previous, document: current } : previous;
          });
        }
      } catch (cause) {
        if (cancelled || controller.signal.aborted) return;
        setState({
          ...INITIAL,
          phase: 'error',
          error: isPdfError(cause)
            ? cause
            : new PdfError('parse-failed', 'load-failed', {
                detail: cause instanceof Error ? cause.message : String(cause),
              }),
        });
      }
    }

    void run(source);

    return () => {
      cancelled = true;
      controller.abort();
      client.terminate();
      clientRef.current = null;
      for (const entry of runtimeRef.current?.entries.values() ?? []) entry.revoke?.();
      runtimeRef.current = null;
      shownRef.current = null;
      wantedRef.current = null;
      void loaded?.destroy();
    };
  }, [source, attempt]);

  useEffect(() => () => clientRef.current?.terminate(), []);

  const replaceDocument = useCallback((document: AccessibleDocument) => {
    const runtime = runtimeRef.current;
    const shown = shownRef.current;
    const entry = shown ? runtime?.entries.get(shown) : undefined;
    if (entry) entry.document = document;
    setState((previous) => {
      if (previous.phase !== 'ready') return previous;
      // OCR can add headings, or fill a page ahead of the title heading.
      const headingCounts =
        runtime && shown
          ? { ...previous.headingCounts, [shown]: shownHeadingCount(document, runtime.info) }
          : previous.headingCounts;
      return { ...previous, document, headingCounts };
    });
  }, []);

  const selectSource = useCallback((origin: DocumentOrigin) => {
    const runtime = runtimeRef.current;
    const entry = runtime?.entries.get(origin);
    if (!runtime || !entry) return;

    wantedRef.current = origin;

    if (entry.document) {
      shownRef.current = origin;
      setState((previous) => ({
        ...previous,
        document: entry.document,
        structureSource: origin,
        switchError: null,
      }));
      return;
    }

    setState((previous) => ({ ...previous, preparingSource: origin, switchError: null }));
    void (async () => {
      try {
        const enriched = await enrich(entry.raw, runtime);
        if (runtime.controller.signal.aborted) {
          enriched.revoke();
          return;
        }
        entry.revoke = enriched.revoke;
        entry.document = decorate(enriched.document, runtime);
        // Kept even when it is no longer wanted — the work is done, and asking
        // for it again should be instant.
        if (wantedRef.current !== origin) return;
        shownRef.current = origin;
        const prepared = entry.document;
        setState((previous) => ({
          ...previous,
          document: prepared,
          structureSource: origin,
          preparingSource: null,
          headingCounts: {
            ...previous.headingCounts,
            [origin]: shownHeadingCount(prepared, runtime.info),
          },
        }));
      } catch (cause) {
        if (runtime.controller.signal.aborted || wantedRef.current !== origin) return;
        // The document on screen is untouched, so this is a message, not the
        // error state — losing a working reading because a comparison failed
        // would be the worse outcome.
        setState((previous) => ({
          ...previous,
          preparingSource: null,
          switchError: cause instanceof Error ? cause.message : String(cause),
        }));
      }
    })();
  }, []);

  return { ...state, retry, replaceDocument, selectSource };
}

/** `prepareReading`, cancelled with the run. */
function enrich(
  raw: AccessibleDocument,
  runtime: Runtime,
): Promise<{ document: AccessibleDocument; revoke: () => void }> {
  return prepareReading(raw, runtime.pdf, { signal: runtime.controller.signal });
}
