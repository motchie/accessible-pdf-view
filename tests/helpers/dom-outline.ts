import { computeAccessibleName, getRole, isInaccessible } from 'dom-accessibility-api';
import type { OutlineNode } from './outline';

/**
 * Rendered DOM -> accessibility outline.
 *
 * Roles and names come from `dom-accessibility-api`, which implements HTML-AAM
 * and the accessible-name computation, so the mapping under test is the spec's
 * rather than one written here to agree with the renderer. A hand-made table
 * would share the renderer's assumptions and pass for the same reasons the
 * renderer is wrong.
 *
 * ## What is kept
 *
 * Every element with a role becomes a node, except the roles in `TRANSPARENT`:
 * those carry no structure a reader navigates by, so their children are
 * hoisted into the nearest kept ancestor. Hidden content — `hidden`,
 * `aria-hidden="true"`, `display: none`, `visibility: hidden` — is left out
 * with everything under it.
 *
 * ## Names
 *
 *   - heading, link, cell, columnheader, rowheader, listitem, paragraph: the
 *     computed accessible name, or when that is empty, the element's own text.
 *     Own text is its text with whitespace collapsed, leaving out text that
 *     belongs to a kept descendant — except a link's, which is inline and is
 *     part of the sentence it sits in. So a list item holding a paragraph has
 *     no name of its own and the paragraph carries the words, while a
 *     paragraph with a link in it keeps the whole sentence and has the link as
 *     a child.
 *   - row: none unless the author labelled it. ARIA computes a row's name from
 *     its cells, which here would only repeat the children.
 *   - everything else, `img` and `figure` included: the computed accessible
 *     name, which is empty unless something supplies one.
 *
 * All text is NFC-normalised.
 *
 * ## Where this departs from dom-accessibility-api
 *
 * The library (0.7.x) lags HTML-AAM in a few places that matter to the
 * Reader's markup, and each is corrected here, deliberately and only here:
 *
 *   - `<p>` has no role in the library; HTML-AAM maps it to `paragraph`.
 *   - `<th>` is always `columnheader` in the library; a `th` with
 *     `scope="row"` is a `rowheader`.
 *   - `<section>` is a `region` only when it has an accessible name.
 *   - A `figure` with no `aria-label` is named by its `figcaption`.
 *
 * And two that are this outline's own:
 *
 *   - `list` gets the flag `ordered` when the element is `<ol>`. ARIA has one
 *     list role; whether the items are numbered is still something the reader
 *     is told, and a bulleted list where the document has steps is a defect.
 *   - `rowgroup` (`<thead>`, `<tbody>`) is transparent. It is structure for
 *     the table algorithm, not a place a reader stops.
 *
 * ## Attributes
 *
 * heading `level`; list `ordered`; link `href`; and `lang` on any kept element
 * that carries a `lang` attribute. The `document` root takes `lang` from the
 * `<html>` element and `title` from `document.title` — what the Reader sets on
 * the page, not what the PDF says.
 */

/** Roles whose children are hoisted rather than nested. `null` is no role. */
const TRANSPARENT = new Set<string | null>([
  null,
  'generic',
  'none',
  'presentation',
  'rowgroup',
  // Text-level semantics: they change how a run of text is spoken, not where
  // a reader can go. The library returns none of these today; listed so a
  // future version that does cannot silently add nodes.
  'strong',
  'emphasis',
  'code',
  'deletion',
  'insertion',
  'subscript',
  'superscript',
  'mark',
  'time',
]);

/** Roles named from their content, falling back to their own text. */
const TEXT_ROLES = new Set([
  'heading',
  'link',
  'cell',
  'columnheader',
  'rowheader',
  'listitem',
  'paragraph',
]);

/** Kept descendants whose text still belongs to the surrounding sentence. */
const INLINE_ROLES = new Set(['link']);

export interface DomOutlineOptions {
  /** Wrap the result in a `document` node carrying the page's lang and title.
   * Defaults to true. */
  document?: boolean;
}

/** The outline of everything under `root` (not including `root` itself). */
export function domToOutline(root: Element, options: DomOutlineOptions = {}): OutlineNode[] {
  const children = outlineChildren(root);
  if (options.document === false) return children;

  const page = root.ownerDocument;
  const attributes: OutlineNode['attributes'] = {};
  const lang = page.documentElement.getAttribute('lang');
  if (lang) attributes.lang = nfc(lang);
  if (page.title) attributes.title = nfc(page.title);
  return [{ role: 'document', attributes, children }];
}

function outlineChildren(parent: Element): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (const child of Array.from(parent.children)) {
    if (isHidden(child)) continue;
    const role = roleOf(child);
    if (TRANSPARENT.has(role)) {
      out.push(...outlineChildren(child));
    } else {
      out.push(toNode(child, role!));
    }
  }
  return out;
}

function toNode(element: Element, role: string): OutlineNode {
  const node: OutlineNode = { role, attributes: {}, children: outlineChildren(element) };

  if (role === 'heading') {
    const level = element.getAttribute('aria-level') ?? /^h([1-6])$/.exec(element.localName)?.[1];
    if (level) node.attributes.level = level;
  }
  if (role === 'list' && element.localName === 'ol') node.attributes.ordered = true;
  if (role === 'link') {
    const href = element.getAttribute('href');
    if (href !== null) node.attributes.href = nfc(href);
  }
  const lang = element.getAttribute('lang');
  if (lang) node.attributes.lang = nfc(lang);

  const name = nameOf(element, role);
  if (name) node.name = name;
  return node;
}

function roleOf(element: Element): string | null {
  const role = getRole(element);
  if (element.hasAttribute('role')) return role;

  switch (element.localName) {
    case 'p':
      return 'paragraph';
    case 'th':
      return element.getAttribute('scope') === 'row' ? 'rowheader' : role;
    case 'section':
      return computeName(element) ? 'region' : 'generic';
  }
  return role;
}

function nameOf(element: Element, role: string): string {
  if (role === 'row') {
    return element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby')
      ? computeName(element)
      : '';
  }

  const computed = computeName(element);
  if (computed) return computed;

  if (TEXT_ROLES.has(role)) return ownText(element);

  if (role === 'figure') {
    const caption = Array.from(element.children).find((child) => child.localName === 'figcaption');
    if (caption && !isHidden(caption)) return collapse(caption.textContent ?? '');
  }
  return '';
}

function computeName(element: Element): string {
  return nfc(
    collapse(computeAccessibleName(element, { computedStyleSupportsPseudoElements: false })),
  );
}

/** The element's text, minus text that belongs to a kept, non-inline descendant. */
function ownText(element: Element): string {
  let text = '';
  const visit = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === child.TEXT_NODE) {
        text += child.nodeValue ?? '';
        continue;
      }
      if (child.nodeType !== child.ELEMENT_NODE) continue;
      const childElement = child as Element;
      if (isHidden(childElement)) continue;
      if (childElement.localName === 'br') {
        text += ' ';
        continue;
      }
      const role = roleOf(childElement);
      if (!TRANSPARENT.has(role) && !INLINE_ROLES.has(role!)) continue;
      visit(childElement);
    }
  };
  visit(element);
  return nfc(collapse(text));
}

function isHidden(element: Element): boolean {
  if (element.hasAttribute('hidden')) return true;
  if (element.getAttribute('aria-hidden') === 'true') return true;
  const style = (element as HTMLElement).style;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  return isInaccessible(element);
}

/**
 * HTML's whitespace only. `\s` would also fold U+3000, the ideographic space,
 * which is text in Japanese and is not collapsed by a browser either.
 */
function collapse(text: string): string {
  return text.replace(/[ \t\n\f\r]+/g, ' ').replace(/^ | $/g, '');
}

function nfc(text: string): string {
  return text.normalize('NFC');
}
