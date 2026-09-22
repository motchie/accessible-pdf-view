import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfFileInfo } from '../document-model';

/**
 * Reads the PDF's own description of itself.
 *
 * pdf-inspector reports a title and nothing else, so this is where the rest of
 * the document information comes from. `isTagged` is the consequential one: it
 * is how the Reader learns the author supplied real structure, and that it
 * should be preferred over anything inferred from layout.
 *
 * The shape lives in the Document Model (`PdfFileInfo`) so that nothing
 * downstream depends on PDF.js.
 */
export type PdfDocumentInfo = PdfFileInfo;

/**
 * Whether `/MarkInfo` says the document is tagged, in whatever shape this
 * version of PDF.js hands it back.
 *
 * 6.2 returned a plain object. 6.3 returns a `Map` — and ships a type
 * declaration that still says object, so `markInfo?.Marked` type-checks,
 * evaluates to `undefined`, and turns the tagged reading off for every tagged
 * document in the corpus. Nothing in the type system was going to catch that:
 * the compiler was reading a declaration that did not match the code behind
 * it, and the failure is silent because falling back to inferred structure
 * looks like an untagged PDF rather than like a bug.
 *
 * So the shape is decided at runtime and both are accepted. `isTagged` gates
 * the whole tagged path, which makes it the single field here worth being
 * defensive about.
 */
export function isMarked(markInfo: unknown): boolean {
  if (markInfo instanceof Map) return markInfo.get('Marked') === true;
  if (markInfo !== null && typeof markInfo === 'object') {
    return (markInfo as { Marked?: unknown }).Marked === true;
  }
  return false;
}

/** The subset of PDF.js's untyped `info` object this project reads. */
interface RawInfo {
  Title?: unknown;
  Author?: unknown;
  Subject?: unknown;
  Keywords?: unknown;
  Creator?: unknown;
  Producer?: unknown;
  CreationDate?: unknown;
  ModDate?: unknown;
  Language?: unknown;
  PDFFormatVersion?: unknown;
  IsLinearized?: unknown;
  IsAcroFormPresent?: unknown;
}

export async function readPdfDocumentInfo(
  document: PDFDocumentProxy,
): Promise<PdfDocumentInfo> {
  // `getMetadata` is typed as returning `info: Object`, so every field is
  // treated as unknown and validated here rather than trusted.
  const [meta, markInfo] = await Promise.all([
    document.getMetadata().catch(() => null),
    document.getMarkInfo().catch(() => null),
  ]);

  const info = (meta?.info ?? {}) as RawInfo;
  const xmp = readXmp(meta?.metadata);

  return {
    ...optional('title', text(info.Title)),
    ...optional('author', text(info.Author)),
    ...optional('subject', text(info.Subject)),
    ...optional('keywords', text(info.Keywords)),
    ...optional('creator', text(info.Creator)),
    ...optional('producer', text(info.Producer)),
    ...optional('createdAt', parsePdfDate(text(info.CreationDate))),
    ...optional('modifiedAt', parsePdfDate(text(info.ModDate))),
    ...optional('language', normalizeLanguage(text(info.Language))),
    ...optional('pdfVersion', text(info.PDFFormatVersion)),
    isTagged: isMarked(markInfo),
    ...optional('isLinearized', boolean(info.IsLinearized)),
    ...optional('hasAcroForm', boolean(info.IsAcroFormPresent)),
    ...optional('xmp', xmp),
  };
}

function readXmp(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const getRaw = (metadata as { getRaw?: () => unknown }).getRaw;
  if (typeof getRaw !== 'function') return undefined;
  const raw = getRaw.call(metadata);
  return typeof raw === 'string' && raw !== '' ? raw : undefined;
}

function optional<K extends string, V>(key: K, value: V | undefined | null) {
  return (value === undefined || value === null ? {} : { [key]: value }) as {
    [P in K]?: V;
  };
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * `/Lang` is a BCP-47 tag, but producers are inconsistent about case and some
 * write a locale with an underscore.
 */
function normalizeLanguage(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const tag = value.replace(/_/g, '-').trim();
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(tag)) return undefined;

  const [primary, ...rest] = tag.split('-');
  return [
    primary!.toLowerCase(),
    ...rest.map((part) =>
      part.length === 2 ? part.toUpperCase()
      : part.length === 4 ? part[0]!.toUpperCase() + part.slice(1).toLowerCase()
      : part.toLowerCase(),
    ),
  ].join('-');
}

/**
 * Converts a PDF date string to ISO 8601.
 *
 * The PDF syntax is `D:YYYYMMDDHHmmSSOHH'mm'`, where every component after the
 * year is optional and `O` is `+`, `-` or `Z`. Real documents truncate it at
 * various points, so each component is parsed independently.
 */
export function parsePdfDate(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const match =
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})'?(\d{2})?'?)?/.exec(
      value.trim(),
    );
  if (!match) return undefined;

  const [, year, month = '01', day = '01', hour = '00', minute = '00', second = '00', zulu, sign, offsetHours, offsetMinutes = '00'] =
    match;

  const offset = zulu || !sign ? 'Z' : `${sign}${offsetHours}:${offsetMinutes}`;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;

  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
