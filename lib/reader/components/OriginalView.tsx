import { useEffect, useRef, useState, type JSX } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPageToCanvas } from '../../pdf/pdfjs/renderer';
import { useMessages } from '../../i18n';

/**
 * Original mode: the PDF pages as PDF.js draws them.
 *
 * This is the only view that works for a scanned document, and it is why PDF.js
 * is a dependency from day one rather than a later addition.
 *
 * What a canvas cannot do is carry text, so each page is announced for what it
 * is. A screen reader user is told plainly that the page is an image and that
 * its text is not currently available, rather than being handed a silent
 * graphic.
 */
export interface OriginalViewProps {
  /** The document the analysis pass already loaded. Reusing it avoids parsing
   * a multi-megabyte PDF a second time just to look at it. */
  pdf: PDFDocumentProxy;
  /** 1-indexed pages known to have no extractable text. */
  ocrPages: readonly number[];
}

export function OriginalView({ pdf, ocrPages }: OriginalViewProps): JSX.Element {
  const pageNumbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1);

  return (
    <div className="apv-original">
      {pageNumbers.map((pageNumber) => (
        <OriginalPage
          key={pageNumber}
          pdf={pdf}
          pageNumber={pageNumber}
          requiresOcr={ocrPages.includes(pageNumber)}
        />
      ))}
    </div>
  );
}

function OriginalPage({
  pdf,
  pageNumber,
  requiresOcr,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  requiresOcr: boolean;
}): JSX.Element {
  const m = useMessages();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const controller = new AbortController();
    // Reserve enough width to stay readable, but let the container decide, so
    // browser zoom and narrow windows both work.
    const targetWidth = Math.max(320, Math.min(container.clientWidth || 900, 1400));

    renderPageToCanvas(pdf, pageNumber, canvas, {
      targetWidth,
      signal: controller.signal,
    })
      .then(() => setRendered(true))
      .catch(() => {
        /* Cancelled renders are expected when the view unmounts. */
      });

    return () => controller.abort();
  }, [pdf, pageNumber]);

  const description = requiresOcr
    ? m.original.pageImageOnly(pageNumber)
    : m.original.pageNormal(pageNumber);

  return (
    <div className="apv-original__page" ref={containerRef}>
      <h2 className="apv-original__heading">{m.original.pageHeading(pageNumber)}</h2>
      <p className="apv-original__description">{description}</p>
      {/* The canvas is decorative relative to the description above it: the
          description is the accessible content, so the image is not announced
          twice. */}
      <canvas ref={canvasRef} role="presentation" aria-hidden="true" />
      {!rendered ? <p className="apv-notice">{m.original.rendering}</p> : null}
    </div>
  );
}
