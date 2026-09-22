/**
 * Where the Reader lives in the build output.
 *
 * One definition, because two different things turn it into a URL and they have
 * to agree: the background worker, which opens the Reader for the tab the user
 * acted on, and the redirect rule in `pdf-handler.ts`, which substitutes a PDF's
 * address into it. Two copies would be a working button beside a broken
 * setting, or the reverse.
 */
export const READER_PAGE = '/reader.html';
