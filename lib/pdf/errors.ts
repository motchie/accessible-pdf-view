import { en } from '../i18n/en';

/**
 * Errors that the Reader is expected to show to the user.
 *
 * Every case carries a code so the UI can render an accurate, specific message
 * instead of a generic "failed to load". Cases the MVP knowingly does not
 * support (file:// URLs, blob: URLs from another tab) are represented here so
 * that they produce an explanation rather than a stack trace.
 */
export type PdfErrorCode =
  | 'no-source'
  | 'not-a-pdf'
  | 'unsupported-scheme'
  | 'fetch-failed'
  | 'http-error'
  | 'permission-denied'
  | 'handoff-expired'
  | 'parse-failed'
  | 'ocr-failed';

/**
 * Which sentence to show, which is not the same question as `code`.
 *
 * Three different situations are an `unsupported-scheme`, and a reader who is
 * told only that has been told nothing they can act on. The code is for the
 * program; this is for the person. Both travel, because both are needed.
 */
export type PdfErrorMessage = keyof typeof en.errors;

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  readonly messageKey: PdfErrorMessage;
  readonly detail?: string;

  /**
   * `Error.message` is the English sentence, taken from the catalogue rather
   * than written at the throw site: a console log and a crash report want one
   * language and the reader wants their own, and keeping both from one entry
   * is what stops them saying different things. The Reader renders
   * `messageKey` in the interface's language; `detail` is whatever the browser
   * said, and stays as it came.
   */
  constructor(
    code: PdfErrorCode,
    messageKey: PdfErrorMessage,
    options?: { detail?: string; cause?: unknown },
  ) {
    super(en.errors[messageKey].title, { cause: options?.cause });
    this.name = 'PdfError';
    this.code = code;
    this.messageKey = messageKey;
    this.detail = options?.detail;
  }
}

export function isPdfError(value: unknown): value is PdfError {
  return value instanceof PdfError;
}

/** Serialisable form, for crossing the worker and messaging boundaries. */
export interface SerializedPdfError {
  code: PdfErrorCode;
  messageKey: PdfErrorMessage;
  detail?: string;
}

export function serializePdfError(error: unknown): SerializedPdfError {
  if (isPdfError(error)) {
    return { code: error.code, messageKey: error.messageKey, detail: error.detail };
  }
  // Something that is not ours: its own words are all there is, so they become
  // the detail under a message that does not pretend to know more.
  return {
    code: 'parse-failed',
    messageKey: 'parse-failed',
    detail: error instanceof Error ? error.message : String(error),
  };
}

export function deserializePdfError(error: SerializedPdfError): PdfError {
  return new PdfError(error.code, error.messageKey, { detail: error.detail });
}
