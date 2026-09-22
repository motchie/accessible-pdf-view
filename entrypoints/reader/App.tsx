import { Suspense, lazy, useEffect, useMemo, useState, type JSX } from "react";
import type { DocumentOrigin } from "../../lib/pdf/document-model";
import { PdfError } from "../../lib/pdf/errors";
import { createPdfSource } from "../../lib/pdf/source/handoff-pdf-source";
import type { PdfSource } from "../../lib/pdf/source/pdf-source";
import { DocumentInfoPanel } from "../../lib/reader/components/DocumentInfoPanel";
import {
  ReaderToolbar,
  type ViewMode,
  type ViewOption,
} from "../../lib/reader/components/ReaderToolbar";
import {
  ErrorNotice,
  OcrPageNotice,
  OcrRequiredNotice,
  NoHeadingsNotice,
  PageRequiresOcrNotice,
  RecoveredPageNotice,
  SiteAccessNotice,
  StatusRegion,
} from "../../lib/reader/components/Notices";
import { StructureSourcePicker } from "../../lib/reader/components/StructureSourcePicker";
import {
  MarkdownSourcePicker,
  type MarkdownSource,
} from "../../lib/reader/components/MarkdownSourcePicker";
import { DocumentView } from "../../lib/reader/renderer";
import {
  MessagesProvider,
  messagesFor,
  resolveLocale,
  type Messages,
} from "../../lib/i18n";
import { fileNameFromUrl, readParams } from "../../lib/reader/params";
import { readerTabTitle } from "../../lib/reader/document-title";

/**
 * Four surfaces that no reader needs in order to read.
 *
 * The Reader's entry chunk carries PDF.js, which is ~460 kB and cannot be
 * deferred: the analysis starts with it. What can wait is everything that only
 * matters once somebody asks — the other two views, and the two panels that
 * drive an on-device model. Each is behind a condition already, so the import
 * follows the condition rather than the page load.
 *
 * `null` is the right fallback for the panels: they are additions to a page
 * that is already complete, and a spinner for a chunk this size would flash.
 * The two views get a line of text, because switching to a tab and seeing
 * nothing is a different experience from seeing nothing appear.
 */
const MarkdownView = lazy(async () => ({
  default: (await import("../../lib/reader/components/MarkdownView"))
    .MarkdownView,
}));
const OriginalView = lazy(async () => ({
  default: (await import("../../lib/reader/components/OriginalView"))
    .OriginalView,
}));
const OcrPanel = lazy(async () => ({
  default: (await import("../../lib/reader/components/OcrPanel")).OcrPanel,
}));
const DescribeFiguresPanel = lazy(async () => ({
  default: (await import("../../lib/reader/components/DescribeFiguresPanel"))
    .DescribeFiguresPanel,
}));
import { usePdfAnalysis } from "../../lib/reader/use-pdf-analysis";
import {
  useAppliedSettings,
  useReaderSettings,
} from "../../lib/reader/use-settings";
import { preferredAiLanguage } from "../../lib/reader/settings";
import { usePdfHandlerEnabled } from "../../lib/reader/use-pdf-handler";

/**
 * The Reader.
 *
 * It knows nothing about how it was launched. Everything it needs arrives as a
 * `PdfSource`, which is what makes the planned `application/pdf` MIME-handler
 * entry point a matter of constructing a different source rather than a rewrite.
 */
export default function App(): JSX.Element {
  const params = useMemo(
    () => readParams(window.location.search, window.location.hash),
    [],
  );
  const [mode, setMode] = useState<ViewMode>("reader");
  // Lifted out of the Markdown view so its control can sit in the header, and
  // so the choice survives a trip to the Reader and back.
  const [markdownSource, setMarkdownSource] =
    useState<MarkdownSource>("document");

  const [source, sourceError] = useMemo((): [
    PdfSource | null,
    PdfError | null,
  ] => {
    if (params.error) return [null, params.error];
    try {
      return [createPdfSource(params), null];
    } catch (cause) {
      return [null, cause instanceof PdfError ? cause : null];
    }
  }, [params]);

  // Written by the side panel, which is a different document — storage is the
  // seam, and the hook is watching it.
  const { settings } = useReaderSettings();
  useAppliedSettings(settings);

  // The Reader's own language. Not the document's — that is `lang` on the
  // article below — and not the one descriptions are generated in, unless the
  // reader has said to use it for that too.
  const locale = resolveLocale(settings.uiLanguage);
  const m = messagesFor(locale);

  // `undefined` unless the reader overruled the document, which leaves the two
  // panels to work the language out from the document as they always have.
  const preferredLanguage = preferredAiLanguage(settings);

  // Not a setting of ours — the browser's own answer to "do PDFs come here".
  // The toolbar needs it because it changes what its link to the original does.
  const opensInReader = usePdfHandlerEnabled();

  const analysis = usePdfAnalysis(source, {
    preferred: settings.structureSource,
  });
  const error = sourceError ?? analysis.error;

  // What this document is called: its own title if it declares one, the file
  // name if not, and nothing at all if neither. The heading falls back to the
  // extension's name; the tab title leaves the part out instead.
  const documentName =
    analysis.document?.metadata.title?.trim() || fileNameFromUrl(params.sourceUrl) || null;
  const title = documentName ?? m.app.name;

  useEffect(() => {
    // Keeping the tab title in sync is how a screen reader user confirms which
    // document this tab holds, and which view it was left in, when cycling
    // through tabs.
    document.title = readerTabTitle(m, {
      // `error` rather than the phase when something failed before the analysis
      // started — a bad parameter leaves the phase at `idle` while the Reader
      // is showing an error, and a tab that says nothing about that is a tab
      // you have to open to find out.
      phase: error ? "error" : analysis.phase,
      view: mode,
      name: documentName,
    });
  }, [m, analysis.phase, error, mode, documentName]);

  // The interface's language, declared on the document that holds it. Without
  // this a Japanese interface inside a page marked `lang="en"` is read out by
  // an English voice, which is the same failure the article's own `lang`
  // exists to prevent one level down.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const views: ReadonlyArray<ViewOption> = [
    { id: "reader", ...m.views.reader },
    { id: "original", ...m.views.original, disabled: analysis.pdf === null },
    {
      id: "markdown",
      ...m.views.markdown,
      disabled: analysis.phase !== "ready",
    },
  ];

  return (
    <MessagesProvider locale={locale}>
      <a className="apv-skip-link" href="#apv-main">
        {m.app.skipToContent}
      </a>

      <ReaderToolbar
        views={views}
        active={mode}
        onChange={setMode}
        fileName={fileNameFromUrl(params.sourceUrl)}
        sourceUrl={params.sourceUrl}
        opensInReader={opensInReader}
      />

      <header className="apv-header">
        <h1 className="apv-title">{title}</h1>
        <StatusRegion message={statusMessage(analysis, m)} />

        <DocumentInfoPanel
          info={analysis.info}
          structureSource={analysis.structureSource}
          pageCount={analysis.document?.metadata.pageCount ?? 0}
        />

        {/* Statements about the whole document, and the controls that change
            them, so they belong with the document's own information rather
            than inside the text they change — above the rule, never between
            the reader and the body. */}
        {analysis.phase === "ready" ? (
          <>
            <StructureSourcePicker
              sources={analysis.availableSources}
              active={analysis.structureSource}
              preparing={analysis.preparingSource}
              error={analysis.switchError}
              headingCounts={analysis.headingCounts}
              onSelect={analysis.selectSource}
            />
            {mode === "markdown" ? (
              <MarkdownSourcePicker
                value={markdownSource}
                onChange={setMarkdownSource}
                structureSource={analysis.structureSource}
                rawUnavailable={analysis.markdown === null}
              />
            ) : null}

            {/* Whether this document can be read at all, what its pictures
                are, and the controls that change both answers. All of it is
                about the whole document, like the picker above, so it belongs
                here rather than stacked on top of the first page.

                Being here also takes them out of the Reader tab, which is the
                point: the pages needing OCR are the ones the reader goes to
                Original to look at, and a live region inside a `hidden` tab
                panel is announced by nothing — so a run watched from Original
                used to go quiet. Both panels run for minutes and report their
                progress that way. */}
            {analysis.capabilities ? (
              <OcrRequiredNotice
                capabilities={analysis.capabilities}
                viewingOriginal={mode === "original"}
              />
            ) : null}
            {analysis.pdf &&
            analysis.document &&
            analysis.capabilities?.requiresOcr ? (
              <Suspense fallback={null}>
                <OcrPanel
                  document={analysis.document}
                  pdf={analysis.pdf}
                  // The parser's list, which does not change as OCR runs. The
                  // panel narrows it against the live document to work out what
                  // is still unread — if this shrank instead, the panel would
                  // vanish on the last page and take its own result
                  // announcement with it.
                  pages={ocrCandidatePages(analysis)}
                  viewingOriginal={mode === "original"}
                  preferredLanguage={preferredLanguage}
                  onDocumentChange={analysis.replaceDocument}
                />
              </Suspense>
            ) : null}
            {analysis.pdf && analysis.document ? (
              <Suspense fallback={null}>
                <DescribeFiguresPanel
                  document={analysis.document}
                  pdf={analysis.pdf}
                  preferredLanguage={preferredLanguage}
                  onDocumentChange={analysis.replaceDocument}
                />
              </Suspense>
            ) : null}
          </>
        ) : null}
      </header>

      <main id="apv-main" className="apv-main">
        {error ? (
          <ErrorNotice
            error={error}
            onRetry={source ? analysis.retry : undefined}
          >
            {/* Only a fetch that was refused can be answered by granting the
                site. Every other error here means something else, and offering
                a permission for it would be a wrong diagnosis in the one place
                a reader is looking for the right one. */}
            {error.messageKey === "fetch-failed" && params.sourceUrl ? (
              <SiteAccessNotice
                sourceUrl={params.sourceUrl}
                // Retried in place, not reloaded. Whether a permission granted
                // at runtime reaches an extension page that is already open is
                // the browser's own business and was the open question here;
                // measured on Firefox 2026-09-22, it does — the retry reads the
                // document. A reload would also work and takes the live region
                // with it, so this keeps the smaller of the two.
                onGranted={analysis.retry}
              />
            ) : null}
          </ErrorNotice>
        ) : null}

        {!error && analysis.phase !== "ready" ? (
          <p className="apv-notice">{statusMessage(analysis, m)}</p>
        ) : null}

        {analysis.phase === "ready" && analysis.document ? (
          <>
            <section
              id="apv-panel-reader"
              aria-label={m.views.readerPanelLabel}
              hidden={mode !== "reader"}
              // A tab panel that owns no focusable content still needs to be
              // reachable, so a keyboard user can get into the document body.
              tabIndex={0}
            >
              {betterHeadings(analysis) ? (
                <NoHeadingsNotice
                  otherLabel={
                    m.structure.sources[betterHeadings(analysis)!.origin].label
                  }
                  otherCount={betterHeadings(analysis)!.count}
                />
              ) : null}
              <article
                className="apv-article"
                lang={analysis.document.metadata.language}
              >
                <DocumentView
                  document={analysis.document}
                  headingOffset={1}
                  renderPageNotice={(page) => {
                    if (page.status === "requires-ocr") {
                      return (
                        <PageRequiresOcrNotice
                          pageNumber={page.pageNumber}
                          {...(page.contentKind
                            ? { contentKind: page.contentKind }
                            : {})}
                          {...(page.ocrCauses
                            ? { ocrCauses: page.ocrCauses }
                            : {})}
                        />
                      );
                    }
                    // Machine-read text is labelled where it is read, and so
                    // is a reading order OCR changed.
                    if (page.origin === "ocr") {
                      return (
                        <OcrPageNotice
                          pageNumber={page.pageNumber}
                          {...(page.carriedFigures
                            ? { carriedFigures: page.carriedFigures }
                            : {})}
                        />
                      );
                    }
                    // As is text that survived only because a second producer
                    // was asked — with its structure lost.
                    if (page.origin === "pdf-text") {
                      return (
                        <RecoveredPageNotice pageNumber={page.pageNumber} />
                      );
                    }
                    return null;
                  }}
                />
              </article>
            </section>

            <section
              id="apv-panel-original"
              aria-label={m.views.originalPanelLabel}
              hidden={mode !== "original"}
              tabIndex={0}
            >
              {/* Mounted only while visible: rasterising every page of a long
                  PDF in the background would burn memory for a view the user
                  may never open. */}
              {mode === "original" && analysis.pdf ? (
                <Suspense
                  fallback={<p className="apv-notice">{m.status.analyzing}</p>}
                >
                  <OriginalView
                    pdf={analysis.pdf}
                    ocrPages={analysis.capabilities?.ocrPages ?? []}
                  />
                </Suspense>
              ) : null}
            </section>

            <section
              id="apv-panel-markdown"
              aria-label={m.views.markdownPanelLabel}
              hidden={mode !== "markdown"}
              tabIndex={0}
            >
              {mode === "markdown" ? (
                <Suspense
                  fallback={<p className="apv-notice">{m.status.analyzing}</p>}
                >
                  <MarkdownView
                    document={analysis.document}
                    rawMarkdown={analysis.markdown}
                    source={markdownSource}
                  />
                </Suspense>
              ) : null}
            </section>
          </>
        ) : null}
      </main>

      <footer className="apv-footer">
        <p>{m.app.footerPrivacy}</p>
        <p>
          <a
            href="https://accessiblepdfview.org"
            target="_blank"
            rel="noopener noreferrer"
          >
            accessiblepdfview.org
            <span className="apv-visually-hidden">{m.app.openInNewTab}</span>
          </a>
        </p>
      </footer>
    </MessagesProvider>
  );
}

/**
 * Pages OCR could be offered for.
 *
 * pdf-inspector's own list is authoritative and, crucially, fixed — it is not
 * recomputed as pages are read. Some documents set `requiresOcr` without naming
 * pages (nothing parsed at all), so the document's own page statuses fill in.
 */
function ocrCandidatePages(
  analysis: ReturnType<typeof usePdfAnalysis>,
): number[] {
  const listed = analysis.capabilities?.ocrPages ?? [];
  if (listed.length > 0) return listed;
  return (analysis.document?.pages ?? [])
    .filter((page) => page.status === "requires-ocr")
    .map((page) => page.pageNumber);
}

/**
 * The other reading, when this one has no headings and that one does.
 *
 * Both halves matter. Saying "no headings" without an alternative is a
 * complaint about the document; saying it with one is a route. And a reading
 * that also has none is not an alternative worth sending anyone to.
 */
function betterHeadings(
  analysis: ReturnType<typeof usePdfAnalysis>,
): { origin: DocumentOrigin; count: number } | null {
  const current = analysis.structureSource;
  if (!current || (analysis.headingCounts[current] ?? 0) > 0) return null;

  for (const origin of analysis.availableSources) {
    const count = analysis.headingCounts[origin] ?? 0;
    if (origin !== current && count > 0) return { origin, count };
  }
  return null;
}

function statusMessage(
  analysis: ReturnType<typeof usePdfAnalysis>,
  m: Messages,
): string {
  switch (analysis.phase) {
    case "idle":
      return "";
    case "fetching":
      return m.status.fetching;
    case "analyzing":
      return m.status.analyzing;
    case "error":
      return m.status.loadFailed;
    case "ready": {
      const pageCount = analysis.document?.metadata.pageCount ?? 0;
      // Announced together with completion so a screen reader user learns about
      // the OCR situation without having to go looking for it.
      return analysis.capabilities?.requiresOcr
        ? m.status.readyNeedsOcr(pageCount)
        : m.status.ready(pageCount);
    }
  }
}
