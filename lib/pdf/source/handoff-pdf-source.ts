import { takeHandoff } from '../../browser/handoff';
import { PdfError } from '../errors';
import type { PdfSource } from './pdf-source';
import { UrlPdfSource } from './url-pdf-source';

/**
 * The primary source for the action-launched flow.
 *
 * The background service worker fetched the PDF while it still held the
 * `activeTab` host grant and parked the bytes; this reads them back. If the
 * handoff is gone (Reader tab reloaded, service worker restarted) it falls back
 * to fetching the original URL directly, which succeeds for same-origin and
 * CORS-enabled documents.
 */
export class HandoffPdfSource implements PdfSource {
  readonly id = 'handoff';

  /**
   * Taking the handoff consumes it, so the result is remembered. Asking a
   * source for its bytes twice must give the same bytes — React's StrictMode
   * runs effects twice in development, and without this the second run would
   * find the handoff already gone and fall back to a cross-origin fetch that is
   * very likely to be blocked.
   */
  private pending: Promise<ArrayBuffer> | null = null;

  constructor(
    private readonly handoffId: string,
    private readonly originalUrl: string | null,
  ) {}

  getOriginalUrl(): string | null {
    return this.originalUrl;
  }

  getBytes(): Promise<ArrayBuffer> {
    this.pending ??= this.fetchBytes().catch((cause: unknown) => {
      // Forgotten again on failure. What this memo protects is a *successful*
      // take — the handoff is consumed by reading it, so a second call has to
      // give back the same bytes rather than find the cache empty. A failure
      // consumed nothing, and remembering it would make the Reader's own retry
      // button replay the old error without trying: which is exactly the
      // button somebody presses after granting access to the site that refused.
      this.pending = null;
      throw cause;
    });
    return this.pending;
  }

  private async fetchBytes(): Promise<ArrayBuffer> {
    const bytes = await takeHandoff(this.handoffId);
    if (bytes) return bytes;

    if (this.originalUrl) {
      return new UrlPdfSource(this.originalUrl).getBytes();
    }

    throw new PdfError(
      'handoff-expired',
      'handoff-expired',
    );
  }
}

/** Builds the right source for the parameters the Reader tab was opened with. */
export function createPdfSource(params: {
  handoffId: string | null;
  sourceUrl: string | null;
}): PdfSource {
  if (params.handoffId) {
    return new HandoffPdfSource(params.handoffId, params.sourceUrl);
  }
  if (params.sourceUrl) {
    return new UrlPdfSource(params.sourceUrl);
  }
  throw new PdfError('no-source', 'no-source');
}
