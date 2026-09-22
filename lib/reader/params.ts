import { PdfError, type PdfErrorCode, type PdfErrorMessage } from '../pdf/errors';
import { en } from '../i18n/en';

/**
 * What the background worker put in the Reader tab's URL.
 *
 * Pure string handling, kept out of the component so it can be tested without
 * mounting anything and so `App` is about layout rather than parsing. The
 * Reader is deliberately ignorant of how it was launched — everything it needs
 * arrives here, which is what makes the planned `application/pdf` MIME-handler
 * entry point a matter of producing a different URL rather than a rewrite.
 *
 * Two things write that URL now. The background worker builds a query, because
 * it can encode one properly and it has a handoff id to pass as well. The
 * redirect rule cannot encode anything, so it writes the address into the
 * fragment instead — see `pdf-handler.ts`.
 */
export interface ReaderParams {
  sourceUrl: string | null;
  handoffId: string | null;
  /** The background worker failed before the Reader ever opened, and said so
   * in the URL. Rendering that is the Reader's job. */
  error: PdfError | null;
}

export function readParams(search: string, hash = ''): ReaderParams {
  const query = new URLSearchParams(search);

  const code = query.get('error');
  if (code) {
    return {
      sourceUrl: null,
      handoffId: null,
      // The key crosses as a key, never as a sentence: the background page
      // and the Reader may be rendering in different languages, and the one
      // that shows the error is the one that should choose the words.
      error: new PdfError(code as PdfErrorCode, messageKeyFrom(query), {
        detail: query.get('errorDetail') ?? undefined,
      }),
    };
  }

  return {
    // The query first: it is the flow that can also carry a handoff, and a
    // Reader opened that way has bytes waiting for it.
    sourceUrl: query.get('src') || sourceFromHash(hash),
    handoffId: query.get('handoff') || null,
    error: null,
  };
}

/**
 * The address the redirect rule put in the fragment.
 *
 * Everything after `#src=` is the address, taken exactly as it stands. It is
 * not run through `URLSearchParams`, which would read a PDF's own `?a=1&b=2` as
 * two more parameters of ours and would turn a `+` in a file name into a space.
 * Nothing needs decoding either: what the rule copied in was a request URL,
 * which is already encoded.
 */
function sourceFromHash(hash: string): string | null {
  const marker = '#src=';
  if (!hash.startsWith(marker)) return null;
  return hash.slice(marker.length) || null;
}

/** The document's file name, for the tab title when the PDF declares none.
 * A name is how a screen reader user tells one open tab from another. */
export function fileNameFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const path = new URL(url).pathname;
    const name = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '');
    return name || null;
  } catch {
    // A relative or malformed URL has no file name to offer. Not an error —
    // the caller falls back to the extension's own title.
    return null;
  }
}

/** A key this build knows, or the message that admits it does not. A URL is
 * user-editable and an unknown key must not become an undefined sentence. */
function messageKeyFrom(query: URLSearchParams): PdfErrorMessage {
  const key = query.get('errorKey');
  return key && key in en.errors ? (key as PdfErrorMessage) : 'unknown';
}
