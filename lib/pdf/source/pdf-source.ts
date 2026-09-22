/**
 * How the Reader obtains PDF bytes.
 *
 * The Reader never fetches anything itself. Swapping this interface is how the
 * project will later support being launched as Chrome's `application/pdf` MIME
 * handler, or opened from a local file, without the parser, the OCR pipeline,
 * the Document Model or the Reader UI changing at all.
 *
 * Implemented today:
 *   - UrlPdfSource       — direct fetch, for same-origin and CORS-enabled URLs
 *   - HandoffPdfSource   — bytes the background worker already fetched
 *   - BytesPdfSource     — in-memory bytes (tests, future file picker)
 *
 * Planned:
 *   - MimeHandlerPdfSource — Chrome PDF MIME handler stream
 *   - FilePdfSource        — <input type="file"> / drag and drop
 *   - BlobPdfSource        — blob: URL created by the page being viewed
 */
export interface PdfSource {
  /** Stable identifier, used in log and error messages. */
  readonly id: string;
  getBytes(): Promise<ArrayBuffer>;
  /** The address the PDF came from, for the "open the original PDF" link.
   * Null when there is no meaningful URL (e.g. a picked local file). */
  getOriginalUrl(): string | null;
}

/** A source backed by bytes we already hold. */
export class BytesPdfSource implements PdfSource {
  readonly id = 'bytes';

  constructor(
    private readonly bytes: ArrayBuffer,
    private readonly originalUrl: string | null = null,
  ) {}

  async getBytes(): Promise<ArrayBuffer> {
    return this.bytes;
  }

  getOriginalUrl(): string | null {
    return this.originalUrl;
  }
}
