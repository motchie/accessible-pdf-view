import { useEffect, useState, type JSX, type ReactNode } from 'react';
import {
  hasSiteAccess,
  hostOf,
  isSiteAccessSupported,
  requestSiteAccess,
} from '../../browser/site-access';
import type { PageContentKind, PageOcrCause, PdfCapabilities } from '../../pdf/document-model';
import type { PdfError } from '../../pdf/errors';
import { useMessages, type Messages } from '../../i18n';

/**
 * Status and error messaging.
 *
 * The wording rules here are a product requirement, not a style preference: a
 * document that needs OCR has been read correctly, and telling the user
 * "analysis failed" would be false. Errors and OCR notices therefore use
 * different components, different roles and different words.
 */

/** Live region for progress. Present from first render — a live region that is
 * inserted at the same moment as its text is frequently not announced. */
export function StatusRegion({ message }: { message: string }): JSX.Element {
  return (
    <div role="status" className="apv-status">
      {message}
    </div>
  );
}

export function ErrorNotice({
  error,
  onRetry,
  children,
}: {
  error: PdfError;
  onRetry?: () => void;
  /** Anything that can be done about this particular error. Inside the alert
   * rather than after it, so the offer is announced with the problem instead
   * of waiting to be found. */
  children?: ReactNode;
}): JSX.Element {
  const m = useMessages();

  return (
    <div role="alert" className="apv-notice apv-notice--error">
      <p className="apv-notice__title">{m.errors[error.messageKey].title}</p>
      {m.errors[error.messageKey].explanation ? (
        <p>{m.errors[error.messageKey].explanation}</p>
      ) : null}
      {/* Whatever the browser said — a status code, an exception. Not
          translated, because it is not ours to translate. */}
      {error.detail ? <p className="apv-notice__detail">{error.detail}</p> : null}
      {children}
      {onRetry ? (
        <p>
          <button type="button" onClick={onRetry}>
            {m.notices.retry}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The OCR-required notice.
 *
 * Never phrased as a failure. It says what is true — some pages contain no
 * readable text — and points at the view that can still show them.
 */
export function OcrRequiredNotice({
  capabilities,
  viewingOriginal,
}: {
  capabilities: PdfCapabilities;
  /**
   * True when Original is the view on screen.
   *
   * Required rather than optional: this notice moved into the header, where it
   * is visible from every view, and the one line in it that points somewhere
   * else is only worth saying from somewhere else.
   */
  viewingOriginal: boolean;
}): JSX.Element | null {
  const m = useMessages();

  if (!capabilities.requiresOcr) return null;

  const pageList = capabilities.ocrPages;
  const scope =
    pageList.length === 0
      ? m.notices.ocrRequired.wholeDocument
      : pageList.length === 1
        ? m.notices.ocrRequired.onePage(pageList[0]!)
        : m.notices.ocrRequired.pages(pageList.join(', '));

  return (
    <div className="apv-notice apv-notice--info">
      <p className="apv-notice__title">{m.notices.ocrRequired.title}</p>
      <p>
        {scope} {m.notices.ocrRequired.mayHelp}
      </p>
      {/* Whether an OCR engine is actually usable is the OCR panel's business —
          it is the thing that knows. This notice used to assert flatly that the
          build contained no OCR engine, which stopped being true.

          The route to Original is worth offering from the Reader and from
          Markdown. From Original it is an instruction to go where the reader
          already is, which costs a line of reading to learn nothing. */}
      {viewingOriginal ? null : <p>{m.notices.ocrRequired.originalHint}</p>}
      {capabilities.hasEncodingIssues ? (
        <p>{m.notices.ocrRequired.encodingIssue}</p>
      ) : null}
    </div>
  );
}

/**
 * Rendered inside Reader mode where a page produced no text.
 *
 * The wording follows what the page actually draws. It used to say the page
 * was stored as an image unconditionally, which contradicted itself on a
 * common kind of document: a deck exported with its text converted to outlines
 * has no image anywhere on the page, so the reader was told there was an image
 * and then shown none. There is no way to settle that by looking at the page,
 * so the message has to be true rather than merely reassuring.
 */
export function PageRequiresOcrNotice({
  pageNumber,
  contentKind,
  ocrCauses,
}: {
  pageNumber: number;
  contentKind?: PageContentKind;
  ocrCauses?: readonly PageOcrCause[];
}): JSX.Element {
  const m = useMessages();

  return (
    <p className="apv-notice apv-notice--page">
      {m.notices.pageLabel(pageNumber)}
      {pageContentExplanation(m, contentKind, ocrCauses)}
    </p>
  );
}

/**
 * Rendered above a page whose text came from OCR.
 *
 * Same rule as a generated figure description: a machine's reading of a picture
 * of text is not the document's own text, and the person least able to check it
 * is the one most likely to be relying on it. So it is labelled at the point of
 * reading, every time — not once in a panel they may have scrolled past.
 */
export function OcrPageNotice({
  pageNumber,
  carriedFigures,
}: {
  pageNumber: number;
  /** Figures the OCR merge had to move to the end of this page. */
  carriedFigures?: number;
}): JSX.Element {
  const m = useMessages();

  return (
    <p className="apv-notice apv-notice--page">
      {m.notices.pageLabel(pageNumber)}
      {m.notices.ocrPage}
      {/* The moved figures are said here, not in a panel: the reading order on
          this page is no longer the document's, and that is only checkable
          while reading this page. */}
      {carriedFigures ? m.notices.carriedFigures(carriedFigures) : ''}
    </p>
  );
}

/**
 * A page the chosen reading dropped, read back from PDF.js.
 *
 * Worth saying out loud: the words are the document's own, but their shape is
 * not. Headings, tables and lists on this page were not recovered, so heading
 * navigation will skip it — and a reader who is navigating by heading needs to
 * know that rather than concluding the page has none.
 */
export function RecoveredPageNotice({ pageNumber }: { pageNumber: number }): JSX.Element {
  const m = useMessages();

  return (
    <p className="apv-notice apv-notice--page">
      {m.notices.pageLabel(pageNumber)}
      {m.notices.recoveredPage}
    </p>
  );
}

/**
 * Why this page has no readable text.
 *
 * Two sources, and the producer's own answer comes first. `ocrCauses` is what
 * pdf-inspector reported while failing to read the page; `contentKind` is what
 * PDF.js sees painted on it, worked out afterwards by walking the content
 * stream. Where the producer answered, that walk is not run at all.
 *
 * `garbled-text` is the case that made the distinction matter. Such a page is
 * neither a picture nor outlines — its text is there and its font cannot be
 * decoded — so describing what it draws would send the reader looking for
 * something that is not on the page.
 */
/**
 * Rendered when the reading on screen has no headings at all.
 *
 * Measured, not hypothetical: every tagged fixture in this project — five
 * Japanese business documents, all from Microsoft Word — has a structure tree
 * containing paragraphs, tables, lists and figures and **not one heading tag**.
 * The authors formatted their headings by hand, so Word had nothing to tag.
 *
 * For a sighted reader nothing is wrong; the document looks like it has
 * headings. For someone navigating by heading, the document is a single
 * undifferentiated block, and **the absence of a result is indistinguishable
 * from the absence of the feature**. That is the failure this notice exists to
 * prevent — not to apologise for the document, but to say which of the two
 * readings is worth trying.
 *
 * It names a number rather than suggesting vaguely, and it appears only when
 * the other reading genuinely has some.
 */
export function NoHeadingsNotice({
  otherLabel,
  otherCount,
}: {
  otherLabel: string;
  otherCount: number;
}): JSX.Element {
  const m = useMessages();

  return (
    <p className="apv-notice apv-notice--info">
      {m.notices.noHeadings(otherLabel, otherCount)}
    </p>
  );
}

/** The three causes that say the same thing as looking at the page. */
const CAUSE_KINDS: Partial<Record<PageOcrCause, PageContentKind>> = {
  scanned: 'image',
  'no-text': 'blank',
  'vector-text': 'vector',
};

/** Takes its messages rather than reaching for them: it is called from a
 * component *and* from the OCR panel's per-page list, and a pure function is
 * what the tests can check in either locale. */
export function pageContentExplanation(
  m: Messages,
  kind: PageContentKind | undefined,
  causes?: readonly PageOcrCause[],
): string {
  const cause = causes?.[0];
  if (cause === 'garbled-text') return m.pageContent.garbled;

  switch (cause ? CAUSE_KINDS[cause] : kind) {
    case 'image':
      return m.pageContent.image;
    case 'vector':
      return m.pageContent.vector;
    case 'blank':
      return m.pageContent.blank;
    default:
      // Neither source answered — say only what is certain.
      return m.pageContent.unknown;
  }
}

/**
 * The offer to grant one site.
 *
 * Shown only where it is the actual answer: the fetch failed, the document is
 * on an `http(s)` site, the browser can be asked, and it has not already said
 * yes — because a button that opens a prompt the browser answers instantly is
 * a button that appears to do nothing, and because access that already exists
 * means the failure was something else and pointing at permissions would be a
 * wrong diagnosis.
 *
 * It renders nothing until those are known, which is why the first answer this
 * gives is `null` rather than a spinner: this sits inside an alert that has
 * already said what went wrong, and a placeholder there would be noise.
 */
export function SiteAccessNotice({
  sourceUrl,
  onGranted,
}: {
  sourceUrl: string;
  /** Called once the browser has said yes, so the caller can try again. */
  onGranted: () => void;
}): JSX.Element | null {
  const m = useMessages();
  const host = hostOf(sourceUrl);
  const [offerable, setOfferable] = useState(false);
  const [refused, setRefused] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!host || !isSiteAccessSupported()) return;
    let cancelled = false;
    void hasSiteAccess(sourceUrl).then((granted) => {
      if (!cancelled) setOfferable(!granted);
    });
    return () => {
      cancelled = true;
    };
  }, [sourceUrl, host]);

  if (!host || !offerable) return null;

  async function ask() {
    setRefused(false);
    setFailure(null);
    try {
      // Called with nothing awaited before it: the prompt is only allowed while
      // the click that led here is still a live user gesture.
      if (await requestSiteAccess(sourceUrl)) onGranted();
      else setRefused(true);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <>
      <p>{m.siteAccess.offer(host)}</p>
      <p>
        <button type="button" onClick={() => void ask()}>
          {m.siteAccess.grant(host)}
        </button>
      </p>
      {/* What is being agreed to, next to the thing that agrees to it. */}
      <p className="apv-notice__detail">{m.siteAccess.scope}</p>
      {refused ? <p>{m.siteAccess.refused}</p> : null}
      {failure ? <p>{m.siteAccess.failed(failure)}</p> : null}
    </>
  );
}
