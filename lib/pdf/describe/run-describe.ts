import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument, FigureNode } from '../document-model';
import { collectFigures, mapFigures } from '../document-model';
import { renderRegionToBlob } from '../pdfjs/region-raster';
import type { DescribeOptions, FigureDescriber } from './provider';

/**
 * Runs a describer over every figure that has no author-supplied alternative
 * text, and writes the results back into a new document.
 *
 * The invariant this file exists to hold: a generated description is only ever
 * written together with `alternativeTextSource: 'generated'`. Nothing here can
 * produce a figure that claims the author wrote it.
 *
 * Figures the author *did* describe are skipped entirely. The author's words
 * win, always — a model has no business second-guessing them.
 */
export interface DescribeFiguresParams {
  document: AccessibleDocument;
  pdf: PDFDocumentProxy;
  describer: FigureDescriber;
  /**
   * Language to write descriptions in, overriding the document's own.
   *
   * The caller decides this, because the fallback when a document declares no
   * language is a judgement about the *reader* — see `chooseOutputLanguage`.
   */
  language?: string;
  /** Must be true before a describer that transmits data externally will run. */
  consentGiven?: boolean;
  dpi?: number;
  /**
   * Ceiling for a single figure, in milliseconds.
   *
   * An on-device model can simply not come back — the call neither resolves
   * nor rejects. Without a bound the run hangs at "generating…" forever and
   * every description already produced is stranded with it. Better to give up
   * on one figure and report it.
   */
  timeoutMs?: number;
  /** Cap on the longer edge of the image handed to the describer, in pixels. */
  maxEdge?: number;
  /**
   * Called with the document each time a figure resolves.
   *
   * Results used to be applied only after the whole run finished, so a single
   * stalled figure discarded everything that had already succeeded and the
   * reader saw nothing. Emitting as they land means work is never lost.
   *
   * What arrives is **this run's own document**: the snapshot it was handed,
   * with the figures resolved so far written into it. A caller whose document
   * has moved on since — OCR lands pages one at a time, during exactly this
   * wait — must fold it in with `mergeDescriptions` rather than adopt it, or
   * the snapshot's copy of those pages goes back on screen.
   */
  onFigureResolved?: (document: AccessibleDocument) => void;
  options?: DescribeOptions;
}

export interface DescribeFiguresResult {
  /** The run's own document — the snapshot it started from, with every result
   * written in. Same caveat as `onFigureResolved`: merge, do not adopt. */
  document: AccessibleDocument;
  described: number;
  decorative: number;
  failed: number;
  /**
   * Why each failure happened.
   *
   * Swallowing these was a mistake: a run that describes nothing and reports
   * only a count leaves both the user and the developer with no way to tell a
   * refusal from a crash from an empty reply.
   */
  failures: DescribeFailure[];
  /** One entry per figure attempted, in order. */
  outcomes: FigureOutcome[];
}

/**
 * Why one figure produced nothing, verbatim.
 *
 * English, and not in the message catalogue: this is evidence about what an
 * on-device model did, shown in a `<details>` beside the model's own reply and
 * written to the console. Translating a diagnostic makes it harder to search
 * for and no easier to act on — the sentences the panel says *around* it are
 * in the catalogue, because those are the interface.
 */
export interface DescribeFailure {
  pageNumber: number;
  indexOnPage: number;
  reason: string;
}

/** What happened to one figure, including what the engine literally replied.
 * Every figure produces one, successes included — a verdict that cannot be
 * inspected cannot be trusted or debugged. */
export interface FigureOutcome {
  pageNumber: number;
  indexOnPage: number;
  outcome: 'described' | 'decorative' | 'failed';
  /** The engine's reply verbatim, or the error message. */
  detail: string;
}

export async function describeFigures(
  params: DescribeFiguresParams,
): Promise<DescribeFiguresResult> {
  const { document, pdf, describer } = params;
  const language = params.language ?? document.metadata.language;

  if (describer.sendsDataExternally && !params.consentGiven) {
    throw new Error(
      'Generating image descriptions needs consent: this provider sends images to an external service.',
    );
  }

  const signal = params.options?.signal;
  let described = 0;
  let decorative = 0;
  const failures: DescribeFailure[] = [];
  const outcomes: FigureOutcome[] = [];

  const record = (outcome: FigureOutcome) => {
    outcomes.push(outcome);
    // Deliberately on by default. This path depends on an on-device model
    // whose behaviour cannot be reproduced from the outside, so the raw reply
    // is the only evidence available when it misbehaves.
    console.info(
      `[accessible-pdf-view] figure p${outcome.pageNumber}#${outcome.indexOnPage + 1}: ` +
        `${outcome.outcome} — ${outcome.detail}`,
    );
  };

  const pages = [...document.pages];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex]!;
    if (signal?.aborted) break;

    // The shared traversal reaches figures inside table cells and list items,
    // not just top-level ones — a document whose figures all live in cells
    // would otherwise look as though it had none.
    const figures = collectFigures(page.nodes);
    if (figures.length === 0) continue;

    const updates = new Map<number, FigureNode>();

    for (const [indexOnPage, { figure: node, context }] of figures.entries()) {
      if (signal?.aborted) break;
      if (!needsDescription(node)) continue;

      const region = node.region;
      if (!region) continue;

      params.options?.onProgress?.({ pageNumber: page.pageNumber, indexOnPage });

      // Every branch produces exactly one replacement figure, applied at the
      // bottom. An earlier version updated and `continue`d per branch, and the
      // branch that skipped the publish step silently discarded its own
      // result — one shared exit removes that class of bug entirely.
      let update: FigureNode;

      try {
        const pdfPage = await pdf.getPage(region.pageNumber);
        const image = await renderRegionToBlob(pdfPage, region.bbox, {
          dpi: params.dpi ?? 200,
          maxEdge: params.maxEdge ?? describer.preferredImage?.maxEdge ?? DEFAULT_MAX_EDGE,
          ...(signal ? { signal } : {}),
        });
        pdfPage.cleanup();

        const result = await withTimeout(
          describer.describe(
            {
              image,
              pageNumber: page.pageNumber,
              indexOnPage,
              ...(context ? { caption: context } : {}),
              ...(language ? { language } : {}),
            },
            params.options ?? {},
          ),
          params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        );

        if (result.decorative) {
          decorative++;
          record({
            pageNumber: page.pageNumber,
            indexOnPage,
            outcome: 'decorative',
            detail: result.rawReply?.trim() || '(no reply)',
          });
          // A decorative image is not "missing" its alt text — it has none by
          // design. `alternativeTextSource` travels with it so the Reader can
          // say *who* decided that: a machine's verdict is announced, never
          // applied as silently as an author's would be.
          update = {
            ...node,
            status: 'available',
            alternativeText: '',
            alternativeTextSource: 'generated',
            descriptionAttempted: true,
          };
        } else if (!result.description) {
          const reason = result.rawReply?.trim()
            ? `The model's reply could not be read as a description: ${truncate(result.rawReply.trim())}`
            : 'The model returned an empty reply.';
          failures.push({ pageNumber: page.pageNumber, indexOnPage, reason });
          record({ pageNumber: page.pageNumber, indexOnPage, outcome: 'failed', detail: reason });
          // Record that we tried, so the Reader can say so.
          update = { ...node, descriptionAttempted: true };
        } else {
          described++;
          record({
            pageNumber: page.pageNumber,
            indexOnPage,
            outcome: 'described',
            detail: result.rawReply?.trim() || result.description,
          });
          update = {
            ...node,
            alternativeText: result.description,
            // The two always travel together. See the file comment.
            alternativeTextSource: 'generated',
            status: 'available',
          };
        }
      } catch (cause) {
        // One unreadable figure must not abandon the rest of the document —
        // but the reason is kept rather than discarded.
        const reason =
          cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
        failures.push({ pageNumber: page.pageNumber, indexOnPage, reason });
        record({ pageNumber: page.pageNumber, indexOnPage, outcome: 'failed', detail: reason });
        update = { ...node, descriptionAttempted: true };
      }

      updates.set(indexOnPage, update);

      // Publish after every figure, not just at the end.
      pages[pageIndex] = {
        ...page,
        nodes: mapFigures(page.nodes, (original, index) => updates.get(index) ?? original),
      };
      params.onFigureResolved?.({ ...document, pages: [...pages] });

      // The Prompt API runs on this thread. Yielding between figures lets the
      // live region announce progress and keeps the tab responsive.
      await yieldToBrowser();
    }

  }

  return {
    document: { ...document, pages },
    described,
    decorative,
    failed: failures.length,
    failures,
    outcomes,
  };
}

/**
 * A minute per figure. Generous for a model that is working, and short enough
 * that a model that is not leaves the user with an answer rather than a
 * spinner.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Big enough for a model to read a logo's wordmark, small enough to stay fast.
 * Only a fallback now: a describer that knows what its model consumes says so
 * itself, and Chrome's built-in model resizes everything to 768 square, so the
 * extra 256 pixels this used to send were rendered, encoded and discarded.
 */
const DEFAULT_MAX_EDGE = 1024;

/**
 * Bounds a promise that may never settle.
 *
 * `AbortSignal` is not enough on its own: the engine is free to ignore it, and
 * a call that ignores abort and never resolves takes the whole run with it.
 * Racing guarantees the loop moves on regardless of what the engine does.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`No reply within ${Math.round(ms / 1000)} seconds.`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Keeps a diagnostic readable without dumping a whole model reply into the UI. */
function truncate(text: string, limit = 120): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/** How many figures a run would attempt, so the UI can say so before starting. */
export function countDescribableFigures(document: AccessibleDocument): number {
  return describableFigures(document).total;
}

export interface DescribableFigures {
  total: number;
  /** No alternative text at all. */
  missing: number;
  /** Has alternative text, but the document's own tooling wrote it. */
  machineWritten: number;
}

/**
 * The breakdown, so the panel can describe what it is offering truthfully.
 *
 * "No alternative text" and "alternative text a word processor generated" are
 * different situations for the reader, and lumping them together would make the
 * panel's own sentence false about half its subjects.
 */
export function describableFigures(document: AccessibleDocument): DescribableFigures {
  const figures = document.pages
    .flatMap((page) => collectFigures(page.nodes))
    .filter(({ figure }) => needsDescription(figure) && figure.region !== undefined);

  const machineWritten = figures.filter(
    ({ figure }) => figure.alternativeTextSource === 'document-ai',
  ).length;

  return {
    total: figures.length,
    missing: figures.length - machineWritten,
    machineWritten,
  };
}

function needsDescription(figure: FigureNode): boolean {
  // The author's own text is never replaced, and a description this tool
  // already generated is not regenerated.
  //
  // Text the document's *word processor* generated is the exception. Nobody
  // vouched for it — Word writes it into `/Alt` whether or not the author ever
  // read it — and it is typically a shape inventory ("Image containing
  // timeline") rather than anything a reader can use. Offering to describe it is
  // not overriding an author; it is offering a second machine's opinion in
  // place of a first one, and both are labelled as such.
  if (figure.alternativeTextSource === 'document-ai') return true;

  return figure.alternativeTextSource === undefined && !figure.alternativeText;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
