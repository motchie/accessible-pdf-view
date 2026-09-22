/**
 * URL sanitisation for links extracted from a PDF.
 *
 * A PDF is untrusted input, and its link targets end up in `<a href>` in a page
 * that runs with the extension's own origin and privileges. Only schemes that
 * are meaningful and inert in that context are allowed through; everything else
 * (notably `javascript:`, but also `data:` and `chrome-extension:`) is dropped
 * and the link degrades to plain text.
 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:', 'ftp:']);

/** Control characters, which browsers strip before resolving a URL but
 * `new URL()` does not — the classic `java\0script:` bypass. */
const CONTROL_CHARS = /[\u0000-\u0020\u007F-\u009F]/g;

/**
 * A trailing `|` that pdf-inspector sweeps into a URL when the link is the last
 * thing in a table cell — the fixture in this repository produces
 * `https://example.com/facility/atelier/|`. A pipe is never meaningful
 * at the end of a URL, and leaving it there yields a link that 404s.
 */
const TRAILING_TABLE_PIPE = /\|+$/;

export function sanitizeHref(raw: string): string | null {
  const cleaned = raw.replace(CONTROL_CHARS, '').trim().replace(TRAILING_TABLE_PIPE, '');
  if (cleaned === '') return null;

  // Fragment-only and root-relative links have no meaning in the Reader, which
  // is not serving the original document, so they are dropped rather than
  // silently resolved against the extension's own origin.
  if (cleaned.startsWith('#') || cleaned.startsWith('/')) return null;

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    // pdf-inspector emits bare hostnames ("example.com/doc") reasonably often;
    // treat those as https rather than losing the link entirely.
    if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(cleaned)) {
      try {
        const assumed = new URL(`https://${cleaned}`);
        return assumed.toString();
      } catch {
        return null;
      }
    }
    return null;
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) return null;
  return parsed.toString();
}
