import type { PDFPageProxy } from 'pdfjs-dist';

/**
 * Maps a page's marked-content identifiers to the text and geometry they cover.
 *
 * A PDF's structure tree does not contain text. Its leaves are references to
 * marked-content sections in the page's content stream — `{ type: 'content',
 * id: 'p3R_mc0' }`. The text lives in the content stream, and PDF.js only
 * reports the section boundaries when asked with `includeMarkedContent`. This
 * builds the join between them.
 *
 * Bounding boxes are collected at the same time so that `Link` structure
 * elements, which carry no destination of their own, can be matched to the
 * page's link annotations by position.
 */
export interface MarkedContent {
  text: string;
  bbox: BoundingBox | null;
}

export interface BoundingBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface PageTextIndex {
  get(id: string): MarkedContent | undefined;
  /** Link annotation rectangles, in PDF user space. */
  links: Array<{ url: string; bbox: BoundingBox }>;
}

/** The text-item shape PDF.js yields; its types are loose here. */
interface TextItem {
  type?: string;
  id?: string | null;
  str?: string;
  hasEOL?: boolean;
  width?: number;
  height?: number;
  transform?: number[];
}

export async function buildPageTextIndex(page: PDFPageProxy): Promise<PageTextIndex> {
  const [content, annotations] = await Promise.all([
    page.getTextContent({ includeMarkedContent: true }),
    page.getAnnotations().catch(() => []),
  ]);

  const byId = new Map<string, MarkedContent>();
  // Marked-content sections nest, and text belongs to every section enclosing
  // it, so an explicit stack is needed rather than a single "current" id.
  const open: Array<string | null> = [];

  for (const raw of content.items as TextItem[]) {
    const item = raw;

    if (item.type === 'beginMarkedContent' || item.type === 'beginMarkedContentProps') {
      open.push(item.id ?? null);
      continue;
    }
    if (item.type === 'endMarkedContent') {
      open.pop();
      continue;
    }
    if (typeof item.str !== 'string') continue;

    const box = boxOf(item);
    // A line break inside a structure element is a space, not a paragraph
    // boundary: the element already told us where the paragraph ends.
    const chunk = item.hasEOL ? `${item.str} ` : item.str;

    for (const id of open) {
      if (id === null) continue;
      const existing = byId.get(id);
      if (existing) {
        existing.text += chunk;
        existing.bbox = union(existing.bbox, box);
      } else {
        byId.set(id, { text: chunk, bbox: box });
      }
    }
  }

  const links: PageTextIndex['links'] = [];
  for (const annotation of annotations as Array<{
    subtype?: string;
    url?: string;
    rect?: number[];
  }>) {
    if (annotation.subtype !== 'Link' || typeof annotation.url !== 'string') continue;
    const rect = annotation.rect;
    if (!rect || rect.length < 4) continue;
    links.push({
      url: annotation.url,
      bbox: {
        left: Math.min(rect[0]!, rect[2]!),
        bottom: Math.min(rect[1]!, rect[3]!),
        right: Math.max(rect[0]!, rect[2]!),
        top: Math.max(rect[1]!, rect[3]!),
      },
    });
  }

  return { get: (id) => byId.get(id), links };
}

function boxOf(item: TextItem): BoundingBox | null {
  const transform = item.transform;
  if (!transform || transform.length < 6) return null;

  const left = transform[4]!;
  const bottom = transform[5]!;
  return {
    left,
    bottom,
    right: left + (item.width ?? 0),
    top: bottom + (item.height ?? 0),
  };
}

function union(a: BoundingBox | null, b: BoundingBox | null): BoundingBox | null {
  if (!a) return b;
  if (!b) return a;
  return {
    left: Math.min(a.left, b.left),
    bottom: Math.min(a.bottom, b.bottom),
    right: Math.max(a.right, b.right),
    top: Math.max(a.top, b.top),
  };
}

/**
 * Finds the link annotation covering a structure element.
 *
 * Requires the element's box to sit mostly inside the annotation rather than
 * merely touch it, so that a link does not capture the text next to it.
 */
export function findLinkFor(
  index: PageTextIndex,
  bbox: BoundingBox | null,
): string | null {
  if (!bbox) return null;

  for (const link of index.links) {
    const overlap =
      Math.max(0, Math.min(bbox.right, link.bbox.right) - Math.max(bbox.left, link.bbox.left)) *
      Math.max(0, Math.min(bbox.top, link.bbox.top) - Math.max(bbox.bottom, link.bbox.bottom));
    const area = Math.max(1, (bbox.right - bbox.left) * (bbox.top - bbox.bottom));

    if (overlap / area > 0.5) return link.url;
  }
  return null;
}
