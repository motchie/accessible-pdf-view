import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument, PageContentKind } from '../../pdf/document-model';
import {
  chooseOutputLanguage,
  type SupportedOutputLanguage,
} from '../../pdf/describe/output-language';
import { ChromeAiOcrProvider } from '../../pdf/ocr/chrome-ai-provider';
import { mergeOcrPages, ocrPagesRead } from '../../pdf/ocr/merge';
import { runOcrForPages } from '../../pdf/ocr/run-ocr';
import { pageContentExplanation } from './Notices';
import { rich, useMessages, type Messages } from '../../i18n';

/**
 * Running OCR, one page at a time.
 *
 * `runOcrForPages` has always taken a page list and rasterised only those
 * pages — the pipeline was built for this. What was missing was any way for the
 * user to reach it, so a document whose text is locked in pixels said "OCR
 * would help" and then offered nothing that would do it.
 *
 * Per page, not per document, and that is the point. OCR here is a small
 * on-device model doing seconds of work per page; on a 29-page deck, "run
 * everything" is minutes of waiting for a result the user may only need one
 * page of. So each page gets its own button, and the whole-document button is
 * offered second.
 *
 * **A page appears as soon as it has been read**, rather than at the end of the
 * run. Reading all 29 pages used to change nothing on screen until the last one
 * came back — minutes during which the only evidence the button had worked was
 * a status line. Each page is now merged into the document the moment it
 * resolves, so the document fills in as it is read, and a run that is stopped
 * or fails half way keeps every page it did read. The stop button exists for
 * the same reason: once pages survive, ending a long run early costs nothing.
 *
 * Two rules carried over from the figure describer, for the same reason:
 *
 *   - **Never automatic.** OCR output is a machine's reading of a picture of
 *     text. Presenting it as the document is a claim, and the reader makes it.
 *   - **Never silent.** A page read by OCR is labelled as such wherever it is
 *     read, because whether the transcript matches the page cannot be
 *     confirmed by looking.
 *
 * It sits in the header with the document's own information, above the rule
 * and outside the view tabs — the same place, and for the same reason, as the
 * structure picker: which pages can be read at all is a fact about the whole
 * document, not a part of it. It also has to outlive the Reader tab. The pages
 * this offers to read are exactly the ones a reader opens Original to look at,
 * and a `role="status"` inside a `hidden` tab panel announces nothing, so a run
 * followed from Original used to lose its progress.
 *
 * **The buttons are `aria-disabled` while a run is going, not `disabled`.** A
 * disabled element cannot hold focus, so `disabled` would throw focus to the
 * top of the document at the exact moment the user pressed the thing they
 * meant to press — and the stop button they might want next is then a full
 * walk away. `start` refuses a second run instead.
 *
 * The panel stays visible when no engine is available, unlike the describe
 * panel. There the fallback is an honest placeholder on each figure; here the
 * fallback is a page the user cannot read at all, so the reason has to be said
 * out loud rather than left as an absence.
 */
export interface OcrPanelProps {
  document: AccessibleDocument;
  pdf: PDFDocumentProxy;
  /** 1-indexed pages that produced no text. */
  pages: number[];
  /** True when Original is the view on screen. The fallback this panel offers
   * when no engine is available is "look at the original", which is not worth
   * saying to someone already looking at it. */
  viewingOriginal: boolean;
  /** The language the reader chose in the settings, or `undefined` to read the
   * page in whatever language the document says it is in. */
  preferredLanguage?: SupportedOutputLanguage;
  onDocumentChange: (document: AccessibleDocument) => void;
}

/**
 * Exported so the wording can be checked without a browser. The claims it makes
 * about pages nobody finished reading are the part of this panel most worth
 * pinning: see `tests/ocr-progressive.test.ts`.
 */
export type OcrRunState =
  | { phase: 'idle' }
  | { phase: 'running'; requested: number[]; current: number | null }
  | {
      phase: 'done';
      /** What the run was asked to read. */
      requested: number[];
      /** What it got a result for — a page it never reached is not a page that
       * failed, and the two must not be counted as one thing. */
      attempted: number[];
      /** What actually reached the document. */
      read: number[];
      stopped: boolean;
    }
  | { phase: 'error'; message: string };

export function OcrPanel({
  document,
  pdf,
  pages,
  viewingOriginal,
  preferredLanguage,
  onDocumentChange,
}: OcrPanelProps): JSX.Element | null {
  const m = useMessages();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [run, setRun] = useState<OcrRunState>({ phase: 'idle' });
  const providerRef = useRef<ChromeAiOcrProvider | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Set by the stop button, so a cancelled render is reported as the user's
   * own action rather than as a failure. */
  const stoppedRef = useRef(false);
  /**
   * The document as it is *now*, not as it was when the run started.
   *
   * Each page is merged into this rather than into the run's opening snapshot.
   * Both give the same OCR text, but merging into the snapshot would also undo
   * anything else that reached the document mid-run — a figure description
   * generated while OCR was working, for one.
   */
  const documentRef = useRef(document);
  documentRef.current = document;

  const documentLanguage = document.metadata.language;
  // Which language the page is read *as*. A document that declares the wrong
  // one sends the model looking for the wrong script, so the reader's own
  // answer wins where they have given one.
  const choice = useMemo(
    () => chooseOutputLanguage(documentLanguage, { preferred: preferredLanguage }),
    [documentLanguage, preferredLanguage],
  );

  // Pages still needing OCR — a page read successfully drops out of the list
  // rather than offering a button that would redo work already done. During a
  // run this shortens page by page, which is the list saying what is left.
  const remaining = useMemo(() => {
    const byNumber = new Map(document.pages.map((page) => [page.pageNumber, page]));
    return pages.filter((pageNumber) => byNumber.get(pageNumber)?.status !== 'available');
  }, [pages, document.pages]);

  useEffect(() => {
    let cancelled = false;
    const provider = new ChromeAiOcrProvider();
    providerRef.current = provider;

    void provider.isAvailable({ languages: [choice.language] }).then((result) => {
      if (!cancelled) setAvailable(result);
    });

    return () => {
      cancelled = true;
      abortRef.current?.abort();
      void provider.dispose();
      providerRef.current = null;
    };
  }, [choice.language]);

  if (pages.length === 0) return null;

  async function start(pageNumbers: number[]) {
    const provider = providerRef.current;
    if (!provider || pageNumbers.length === 0) return;
    // The buttons below are `aria-disabled` rather than `disabled`, so they can
    // still be pressed. Refusing here is the other half of that: a second run
    // while one is going would fight the first over the same pages.
    if (run.phase === 'running') return;

    const controller = new AbortController();
    abortRef.current = controller;
    stoppedRef.current = false;
    setRun({ phase: 'running', requested: pageNumbers, current: pageNumbers[0] ?? null });

    // Every page read so far, kept here as well so a stopped or failed run can
    // still report exactly what it read.
    let latest: AccessibleDocument | null = null;

    const finish = (stopped: boolean) => {
      setRun({
        phase: 'done',
        requested: pageNumbers,
        attempted: latest?.pages.map((page) => page.pageNumber) ?? [],
        read: latest ? ocrPagesRead(latest) : [],
        stopped,
      });
    };

    try {
      await runOcrForPages({
        provider,
        pdf,
        pageNumbers,
        pageCount: document.metadata.pageCount,
        sourceUrl: document.metadata.sourceUrl,
        // Each page reaches the reader the moment it is read. A later page that
        // stalls, fails or is stopped must not hide the ones that worked.
        onPageResolved: (partial) => {
          latest = partial;
          onDocumentChange(mergeOcrPages(documentRef.current, partial));
        },
        ocrOptions: {
          languages: [choice.language],
          signal: controller.signal,
          onProgress: ({ pageNumber, ratio }) => {
            // `ratio` is 1 as a page finishes; showing the next page as
            // "current" then would be a lie about what is running.
            if (ratio === 0) {
              setRun({ phase: 'running', requested: pageNumbers, current: pageNumber });
            }
          },
        },
      });
      finish(stoppedRef.current);
    } catch (cause) {
      // Stopping cancels the render in flight, which arrives here as a
      // rejection. That is the user's own instruction, not a failure to report
      // as one — and the pages already read are already on screen.
      if (stoppedRef.current || controller.signal.aborted) finish(true);
      else {
        setRun({
          phase: 'error',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    } finally {
      abortRef.current = null;
    }
  }

  function stop() {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }

  const busy = run.phase === 'running';

  return (
    <section className="apv-panel" aria-labelledby="apv-ocr-heading">
      <h2 id="apv-ocr-heading" className="apv-panel__heading">
        {m.ocrPanel.heading}
      </h2>

      {available === false ? (
        <>
          <p>{m.ocrPanel.unavailable(pages.length)}</p>
          <p className="apv-panel__caveat">
            {m.ocrPanel.unavailableWhy}
            {viewingOriginal ? null : ` ${m.notices.ocrRequired.originalHint}`}
          </p>
        </>
      ) : (
        <>
          <p>{m.ocrPanel.available(remaining.length)}</p>
          <p className="apv-panel__caveat">
            {rich(m.ocrPanel.caveat(m.languages[choice.language]))}
          </p>
          {/* Only when the reader overruled the document. The rest of the time
              the language above came from the document itself, which is what a
              reader would assume anyway. */}
          {choice.source === 'setting' ? (
            <p className="apv-panel__caveat">{m.ocrPanel.languageFromSetting}</p>
          ) : null}
          {/* Says what the run will do, because it is not what a progress bar
              would imply: this does not finish all at once, and stopping it
              does not throw away what it has done. */}
          <p className="apv-panel__caveat">{m.ocrPanel.howItRuns}</p>

          {remaining.length > 0 ? (
            <>
              <p>
                <button
                  type="button"
                  onClick={() => start(remaining)}
                  aria-disabled={busy}
                >
                  {busy ? m.ocrPanel.reading : m.ocrPanel.readAll(remaining.length)}
                </button>
              </p>

              <h3 className="apv-panel__subheading">{m.ocrPanel.perPageHeading}</h3>
              <ul className="apv-panel__rows">
                {remaining.map((pageNumber) => (
                  <li key={pageNumber}>
                    <button
                      type="button"
                      onClick={() => start([pageNumber])}
                      aria-disabled={busy}
                    >
                      {m.ocrPanel.readPage(pageNumber)}
                    </button>{' '}
                    <span className="apv-panel__note">
                      {pageContentExplanation(
                        m,
                        kindOf(document, pageNumber),
                        causesOf(document, pageNumber),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}

      {/* Outside the list above, which empties as pages are read: the run can
          outlive the last button that started it. */}
      {busy ? (
        <p>
          <button type="button" onClick={stop}>
            {m.ocrPanel.stop}
          </button>
        </p>
      ) : null}

      {/* Announced, not merely drawn: a page takes seconds and there is no
          visual spinner a screen reader can report. */}
      <p role="status" className="apv-panel__status">
        {ocrStatusMessage(m, run)}
      </p>

      {run.phase === 'error' ? (
        <p role="alert" className="apv-notice apv-notice--error">
          {m.ocrPanel.failed(run.message)}
        </p>
      ) : null}
    </section>
  );
}

function kindOf(document: AccessibleDocument, pageNumber: number): PageContentKind | undefined {
  return document.pages.find((page) => page.pageNumber === pageNumber)?.contentKind;
}

function causesOf(document: AccessibleDocument, pageNumber: number) {
  return document.pages.find((page) => page.pageNumber === pageNumber)?.ocrCauses;
}

export function ocrStatusMessage(m: Messages, run: OcrRunState): string {
  switch (run.phase) {
    case 'idle':
    case 'error':
      return '';
    case 'running': {
      if (run.current === null) return m.ocrPanel.preparing;
      const done = run.requested.indexOf(run.current) + 1;
      // No progress fraction for a single page — "(1 of 1)" said nothing.
      return run.requested.length === 1
        ? m.ocrPanel.readingPage(run.current)
        : m.ocrPanel.readingPageOf(run.current, run.requested.length, done);
    }
    case 'done': {
      // Naming the pages is useful for a handful and unreadable for thirty.
      const listed =
        run.read.length <= 8 ? m.ocrPanel.pageList(run.read) : m.ocrPanel.pageCountOnly(run.read.length);

      if (run.stopped) {
        // A stopped run says only what it read. The rest divides into pages it
        // never reached and one it gave up on mid-read, and calling either of
        // them unreadable would be a claim about a page nothing finished
        // looking at.
        const parts = [
          run.read.length === 0 ? m.ocrPanel.stoppedNothing : m.ocrPanel.stoppedAfter(listed),
        ];
        const left = run.requested.length - run.read.length;
        if (left > 0) parts.push(m.ocrPanel.notRead(left));
        return parts.join('');
      }

      const parts: string[] = [];
      if (run.read.length === 0) {
        // Not "0 pages read" — say what it means. A page OCR could not read is
        // left as it was rather than being replaced with an empty one.
        parts.push(m.ocrPanel.nothingRead(run.attempted.length));
      } else {
        parts.push(m.ocrPanel.read(listed));
        const failed = run.attempted.length - run.read.length;
        if (failed > 0) parts.push(m.ocrPanel.couldNotRead(failed));
      }
      const skipped = run.requested.length - run.attempted.length;
      if (skipped > 0) parts.push(m.ocrPanel.notRead(skipped));
      return parts.join('');
    }
  }
}
