import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument } from '../../pdf/document-model';
import { ChromeAiFigureDescriber } from '../../pdf/describe/chrome-ai-describer';
import { mergeDescriptions } from '../../pdf/describe/merge';
import {
  chooseOutputLanguage,
  isOutputLanguageSupported,
  type OutputLanguageChoice,
  type SupportedOutputLanguage,
} from '../../pdf/describe/output-language';
import { rich, useMessages, type Messages } from '../../i18n';
import { downloadPercent } from '../download-progress';
import type { DescriberAvailability } from '../../pdf/describe/provider';
import {
  describableFigures,
  describeFigures,
  type FigureOutcome,
} from '../../pdf/describe/run-describe';

/**
 * The control that generates descriptions for figures the document never
 * described.
 *
 * Three things about it are deliberate:
 *
 * 1. **It is never automatic.** The user presses a button. Generating a
 *    description is a claim about an image, and making that claim is the
 *    reader's decision, not the tool's.
 * 2. **It says what it is before it runs**, and every description it produces
 *    is labelled at the point of reading (see `figurePlaceholderText`). The
 *    description cannot be checked against the picture by looking, so the one
 *    thing a reader must always know is where it came from.
 * 3. **It hides itself when nothing would come of it.** No describable figures,
 *    or no on-device model, and the panel is simply not there — rather than a
 *    disabled button the user has to interrogate.
 *
 * It sits in the header with the OCR panel and the structure picker, above the
 * rule and outside the view tabs: what this document's pictures are is a fact
 * about the whole document, not a part of it. It also has to outlive the
 * Reader tab — the run takes minutes and reports its progress through a
 * `role="status"`, which announces nothing from inside a `hidden` tab panel.
 */
export interface DescribeFiguresPanelProps {
  document: AccessibleDocument;
  pdf: PDFDocumentProxy;
  /** The language the reader chose in the settings, or `undefined` to leave
   * the choice to the document. */
  preferredLanguage?: SupportedOutputLanguage;
  onDocumentChange: (document: AccessibleDocument) => void;
}

/**
 * Exported so the wording can be checked without a browser — see
 * `tests/figure-description.test.tsx`.
 */
export type DescribeRunState =
  | { phase: 'idle' }
  | { phase: 'preparing'; loaded: number }
  | {
      phase: 'running';
      total: number;
      /** Figures *started*, which is what the describer reports. Counting a
       * start as a finish is how "5 / 5" came to be shown while the fifth
       * was still being described. */
      started: number;
      /** The page the figure in flight is on, or null before the first one. */
      pageNumber: number | null;
    }
  | {
      phase: 'done';
      described: number;
      decorative: number;
      failed: number;
      outcomes: FigureOutcome[];
    }
  | { phase: 'error'; message: string };

export function DescribeFiguresPanel({
  document,
  pdf,
  preferredLanguage,
  onDocumentChange,
}: DescribeFiguresPanelProps): JSX.Element | null {
  const m = useMessages();
  const [availability, setAvailability] = useState<DescriberAvailability | null>(null);
  const [run, setRun] = useState<DescribeRunState>({ phase: 'idle' });
  const describerRef = useRef<ChromeAiFigureDescriber | null>(null);
  /**
   * The document as it is *now*, not as the run found it.
   *
   * A run works from the snapshot it was handed and publishes that whole
   * snapshot with each figure. Adopting it would undo anything else that
   * reached the document meanwhile — an OCR page landing mid-run, most of all,
   * since both panels are on screen together and neither disables the other.
   * `mergeDescriptions` takes only the figures this run worked on.
   */
  const documentRef = useRef(document);
  documentRef.current = document;

  const describable = describableFigures(document);
  const total = describable.total;
  const documentLanguage = document.metadata.language;
  // Not `document.metadata.language` directly: a document that declares nothing
  // used to mean "write it in English", which is the wrong answer for the
  // person reading it — and a document that declares the wrong language means
  // nothing here can tell. The choice is made once and used everywhere below,
  // so the probe, the session and the announcement cannot disagree.
  const choice = useMemo(
    () => chooseOutputLanguage(documentLanguage, { preferred: preferredLanguage }),
    [documentLanguage, preferredLanguage],
  );
  const language = choice.language;

  useEffect(() => {
    let cancelled = false;
    const describer = new ChromeAiFigureDescriber();
    describerRef.current = describer;

    // The language is part of the probe: availability is per-configuration,
    // and a probe that does not declare an output language is itself a
    // malformed request.
    void describer.isAvailable({ language }).then((result) => {
      if (!cancelled) setAvailability(result);
    });

    return () => {
      cancelled = true;
      void describer.dispose();
      describerRef.current = null;
    };
  }, [language]);

  // Nothing to describe, or nothing to describe it with.
  if (total === 0) return null;
  if (!availability || availability.status === 'unavailable') return null;

  async function start() {
    const describer = describerRef.current;
    if (!describer) return;
    // The button is `aria-disabled` rather than `disabled`, so it stays
    // focusable and can still be pressed; refusing here is what makes that
    // safe. A second run would describe every figure twice.
    if (run.phase === 'preparing' || run.phase === 'running') return;

    setRun({ phase: 'preparing', loaded: 0 });
    try {
      await describer.prepare({
        language,
        onDownloadProgress: (loaded) => setRun({ phase: 'preparing', loaded }),
      });

      let started = 0;
      setRun({ phase: 'running', total, started, pageNumber: null });

      const result = await describeFigures({
        document,
        pdf,
        describer,
        language,
        // Show each description the moment it exists. A later figure that
        // stalls must not hide the ones that already worked.
        onFigureResolved: (partial) =>
          onDocumentChange(mergeDescriptions(documentRef.current, partial)),
        options: {
          // Fired as a figure is picked up, before it is rendered or sent.
          onProgress: ({ pageNumber }) => {
            started++;
            setRun({ phase: 'running', total, started, pageNumber });
          },
        },
      });

      // Merged, not adopted, for the same reason as each figure above. Every
      // description is already in by now, so this changes nothing on a quiet
      // run and is what carries the last one when the document moved under it.
      onDocumentChange(mergeDescriptions(documentRef.current, result.document));
      setRun({
        phase: 'done',
        described: result.described,
        decorative: result.decorative,
        failed: result.failed,
        outcomes: result.outcomes,
      });
    } catch (cause) {
      setRun({
        phase: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  const busy = run.phase === 'preparing' || run.phase === 'running';

  return (
    <section className="apv-panel" aria-labelledby="apv-describe-heading">
      <h2 id="apv-describe-heading" className="apv-panel__heading">
        {m.describePanel.heading}
      </h2>

      <p>{m.describePanel.intro(total)}</p>

      {/* A `/Alt` is not proof a person wrote it. Word and PowerPoint generate
          alternative text and write it into the PDF verbatim, disclaimer and
          all — so "the document has alt text" and "someone described this
          image" are different claims, and only the reader can decide whether
          the existing text is good enough. */}
      {describable.machineWritten > 0 ? (
        <p className="apv-panel__caveat">
          {m.describePanel.machineWritten(describable.machineWritten, describable.missing)}
        </p>
      ) : null}
      <p className="apv-panel__caveat">{rich(m.describePanel.caveat)}</p>

      <p className="apv-panel__caveat">{describeLanguageNote(m, choice)}</p>

      {availability.status === 'downloadable' ? (
        <p className="apv-panel__caveat">{m.describePanel.downloadWarning}</p>
      ) : null}

      <p>
        {/* `aria-disabled`, not `disabled`: a disabled element cannot hold
            focus, so pressing this would drop the user at the top of the
            document — at the start of a run that takes minutes and reports
            itself in the live region below. */}
        <button type="button" onClick={start} aria-disabled={busy}>
          {busy ? m.describePanel.generating : m.describePanel.generate(total)}
        </button>
      </p>

      {/* Progress is announced, not merely drawn: this run takes seconds per
          figure and a screen reader user gets no visual spinner. */}
      <p role="status" className="apv-panel__status">
        {describeStatusMessage(m, run)}
      </p>

      {run.phase === 'error' ? (
        <p role="alert" className="apv-notice apv-notice--error">
          {m.describePanel.failedToGenerate(run.message)}
        </p>
      ) : null}

      {/* Every figure's verdict and the engine's literal reply. A model that
          misbehaves cannot be reproduced from the outside, so this is the only
          evidence available — hiding it would leave a button that appears to
          do nothing. Also written to the browser console. */}
      {run.phase === 'done' && run.outcomes.length > 0 ? (
        <details className="apv-panel__details">
          <summary>{m.describePanel.outcomesSummary(run.outcomes.length)}</summary>
          <ul>
            {run.outcomes.map((outcome, index) => (
              <li key={index}>
                {m.describePanel.outcomeLine(outcome.pageNumber, outcome.indexOnPage + 1)} —{' '}
                {outcomeLabel(m, outcome.outcome)}: {outcome.detail}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * Which language the descriptions will be in, and where that answer came from.
 *
 * The second half is the part worth writing: only one of the four sources is
 * the document's own declaration. The rest are a guess about the reader, an
 * admission that the model cannot write the language asked for, or the reader
 * overruling the document — and a guess presented as the document's own answer
 * is the wrong kind of confidence.
 *
 * Exported so the wording can be checked without a browser.
 */
export function describeLanguageNote(m: Messages, choice: OutputLanguageChoice): string {
  return `${m.describePanel.languageIs(m.languages[choice.language])} ${languageSource(m, choice)}`;
}

function languageSource(m: Messages, choice: OutputLanguageChoice): string {
  switch (choice.source) {
    case 'setting':
      return m.describePanel.languageFromSetting;
    case 'document':
      // A declared language the model cannot write is still the document's own
      // answer — but it is not the language the descriptions will be in, and
      // saying only where it came from would leave that unexplained.
      return isOutputLanguageSupported(choice.from)
        ? m.describePanel.languageFromDocument(choice.from ?? '')
        : m.describePanel.languageUnsupported(choice.from ?? '');
    case 'browser':
      return m.describePanel.languageFromBrowser;
    case 'default':
      return m.describePanel.languageFallback;
  }
}

function outcomeLabel(m: Messages, outcome: FigureOutcome['outcome']): string {
  switch (outcome) {
    case 'described':
      return m.describePanel.outcomeDescribed;
    case 'decorative':
      return m.describePanel.outcomeDecorative;
    case 'failed':
      return m.describePanel.outcomeFailed;
  }
}

export function describeStatusMessage(m: Messages, run: DescribeRunState): string {
  switch (run.phase) {
    case 'idle':
      return '';
    case 'preparing': {
      // In ten steps, not in every value the browser reports — see
      // `downloadPercent`. This is a live region, and a percentage that changes
      // a hundred times is a hundred announcements.
      const percent = downloadPercent(run.loaded);
      return percent === null
        ? m.describePanel.preparingModel
        : m.describePanel.preparingModelAt(percent);
    }
    case 'running': {
      if (run.pageNumber === null) return m.describePanel.generating_;
      // Which one is being worked on and how far in the run it is — not a
      // completed count, because none of them is complete yet.
      // No fraction for a single figure — "(1 of 1)" says nothing.
      return run.total === 1
        ? m.describePanel.describingPage(run.pageNumber)
        : m.describePanel.describingPageOf(run.pageNumber, run.total, run.started);
    }
    case 'done': {
      // A run that described nothing should not open with "0 descriptions
      // generated" — lead with what actually happened.
      if (run.described === 0 && run.decorative === 0) {
        return m.describePanel.noneDescribed(run.failed);
      }
      const parts = [m.describePanel.described(run.described)];
      if (run.decorative > 0) parts.push(m.describePanel.decorativeCount(run.decorative));
      if (run.failed > 0) parts.push(m.describePanel.failedCount(run.failed));
      return parts.join('');
    }
    case 'error':
      return '';
  }
}
