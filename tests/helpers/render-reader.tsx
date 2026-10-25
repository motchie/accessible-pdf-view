import { act, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { MessagesProvider, messagesFor, type Locale, type Messages } from '../../lib/i18n';
import {
  NoHeadingsNotice,
  OcrPageNotice,
  PageRequiresOcrNotice,
  RecoveredPageNotice,
} from '../../lib/reader/components/Notices';
import { readerTabTitle } from '../../lib/reader/document-title';
import { fileNameFromUrl } from '../../lib/reader/params';
import { DocumentView } from '../../lib/reader/renderer';
import { betterHeadings } from '../../lib/reader/structure-source';
import type { ReaderReading } from './read-pdf';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * The Reader's document area, rendered into jsdom.
 *
 * `entrypoints/reader/App.tsx` cannot be mounted here: it reads its PDF from
 * the URL through a handoff source, reads and writes settings through
 * `chrome.storage`, asks the browser whether it is the PDF handler, and runs
 * the analysis hook with its Web Worker. So this renders the parts of it that
 * show the document, copied from it and **to be kept in step with it**:
 *
 *   - `document.title` from `readerTabTitle` (phase `ready`, view `reader`) and
 *     `<html lang>` from the UI locale — the two things App sets on the page;
 *   - the page title `<h1 class="apv-title">`;
 *   - the Reader tab panel, `<section aria-label=…>`, with `NoHeadingsNotice`
 *     under App's own condition (`betterHeadings`, shared with it);
 *   - `<article lang>` holding `DocumentView` with `headingOffset={1}` and the
 *     same `renderPageNotice`.
 *
 * Not rendered, because they are not the document: the skip link, toolbar,
 * status live region, document information panel, reading pickers, the OCR
 * and figure-description panels, the other two tab panels, and the footer.
 * The status region and the panels sit between the `<h1>` and the document in
 * the real page; a reader moving through it meets them there.
 */

export interface RenderedReader {
  /** The element everything was rendered into; walk this for the outline. */
  container: HTMLElement;
  unmount(): void;
}

export function renderReader(
  reading: ReaderReading,
  options: { locale?: Locale; sourceUrl?: string | null } = {},
): RenderedReader {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const locale = options.locale ?? 'ja';
  const m = messagesFor(locale);

  // As App works them out: the document's title, else the file name, else
  // the extension's name for the heading and nothing for the tab.
  const documentName =
    reading.document.metadata.title?.trim() || fileNameFromUrl(options.sourceUrl ?? null) || null;
  // Page-wide, so put back on unmount: the next test in the file must not
  // inherit this one's title and language.
  const previousTitle = document.title;
  const previousLang = document.documentElement.getAttribute('lang');
  document.title = readerTabTitle(m, { phase: 'ready', view: 'reader', name: documentName });
  document.documentElement.lang = locale;

  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MessagesProvider locale={locale}>
        <ReaderDocumentArea reading={reading} title={documentName ?? m.app.name} m={m} />
      </MessagesProvider>,
    );
  });

  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
      document.title = previousTitle;
      if (previousLang === null) document.documentElement.removeAttribute('lang');
      else document.documentElement.setAttribute('lang', previousLang);
    },
  };
}

function ReaderDocumentArea({
  reading,
  title,
  m,
}: {
  reading: ReaderReading;
  title: string;
  m: Messages;
}): JSX.Element {
  const better = betterHeadings(reading);
  return (
    <>
      <header className="apv-header">
        <h1 className="apv-title">{title}</h1>
      </header>
      <main id="apv-main" className="apv-main">
        <section id="apv-panel-reader" aria-label={m.views.readerPanelLabel} tabIndex={0}>
          {better ? (
            <NoHeadingsNotice
              otherLabel={m.structure.sources[better.origin].label}
              otherCount={better.count}
            />
          ) : null}
          <article className="apv-article" lang={reading.document.metadata.language}>
            <DocumentView
              document={reading.document}
              headingOffset={1}
              renderPageNotice={(page) => {
                if (page.status === 'requires-ocr') {
                  return (
                    <PageRequiresOcrNotice
                      pageNumber={page.pageNumber}
                      {...(page.contentKind ? { contentKind: page.contentKind } : {})}
                      {...(page.ocrCauses ? { ocrCauses: page.ocrCauses } : {})}
                    />
                  );
                }
                if (page.origin === 'ocr') {
                  return (
                    <OcrPageNotice
                      pageNumber={page.pageNumber}
                      {...(page.carriedFigures ? { carriedFigures: page.carriedFigures } : {})}
                    />
                  );
                }
                if (page.origin === 'pdf-text') {
                  return <RecoveredPageNotice pageNumber={page.pageNumber} />;
                }
                return null;
              }}
            />
          </article>
        </section>
      </main>
    </>
  );
}
