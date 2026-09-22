import { PdfError } from '../errors';
import type { PdfSource } from './pdf-source';

/**
 * Fetches the PDF directly from its URL.
 *
 * This works when the Reader document is allowed to read the URL: extension
 * URLs, `data:` URLs, and remote URLs whose server sends permissive CORS
 * headers. For the toolbar and context-menu routes it is the fallback path —
 * the primary one is HandoffPdfSource, because the background service worker
 * holds the `activeTab` host grant and the Reader tab does not.
 *
 * For the "Opening PDFs" setting it is the *only* path. A redirected
 * navigation has no gesture behind it and parks no bytes, so the Reader fetches
 * the document itself — which it can, because that setting is exactly the one
 * that grants the Reader host access. See `lib/browser/pdf-handler.ts`.
 *
 * Cases it deliberately rejects with a clear message rather than a network
 * error: `file:` (needs "Allow access to file URLs", which the MVP does not
 * request) and `blob:` (blob URLs are scoped to the document that created
 * them, so the Reader tab can never resolve one from another tab).
 */
export class UrlPdfSource implements PdfSource {
  readonly id = 'url';

  constructor(private readonly url: string) {}

  getOriginalUrl(): string | null {
    return this.url;
  }

  async getBytes(): Promise<ArrayBuffer> {
    const scheme = schemeOf(this.url);

    if (scheme === 'file:') {
      throw new PdfError('unsupported-scheme', 'file-scheme');
    }

    if (scheme === 'blob:') {
      throw new PdfError('unsupported-scheme', 'blob-scheme');
    }

    let response: Response;
    try {
      response = await fetch(this.url, { credentials: 'include' });
    } catch (cause) {
      // Measured, not guessed: this is what a cross-origin PDF link does with
      // the extension's default permissions. It holds no host permission for
      // the linked site, so neither the background prefetch nor this fetch is
      // allowed to read it — see the right-click route, which is why that
      // exists. (A reader who switched "Opening PDFs" to the Reader has granted
      // that access and does not land here.)
      //
      // Which is why the message ends with the route that does work. A reader
      // who is told only that something failed has been given a dead end; the
      // same reader told to open the link and press the toolbar button has been
      // given the answer, and it costs no permission to say it.
      throw new PdfError('fetch-failed', 'fetch-failed', { cause });
    }

    if (!response.ok) {
      throw new PdfError(
        'http-error',
        'http-error',
        {
          // The status is the browser's own fact, so it travels as detail
          // rather than being translated into a sentence about it.
          detail:
            response.status === 401 || response.status === 403
              ? `HTTP ${response.status}`
              : `HTTP ${response.status}`,
        },
      );
    }

    return response.arrayBuffer();
  }
}

function schemeOf(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}
