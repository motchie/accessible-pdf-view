import type { DocumentNode } from '../document-model';
import { inlineToPlainText } from '../document-model';

/**
 * Taking back headings that should never have been headings.
 *
 * pdf-inspector infers headings from layout, and on Japanese business documents
 * it gets a specific, repeatable set of them wrong. Measured across this
 * project's fixtures:
 *
 *   - 「以 上」 — the closing marker of a Japanese business letter, meaning
 *     roughly "end of document" — is promoted to `##` on three of five.
 *   - A wholly parenthesised aside under an image — 「（…）」 — is promoted to
 *     `##` on another.
 *
 * For heading navigation this is worse than having no headings. A reader
 * pressing `H` is told the document's structure, and what they are told is
 * "end". The word is not wrong — it really is at the end — but it is not a
 * section, and it is the only thing there.
 *
 * ## Only demotions
 *
 * Every rule here takes a heading away; none creates one. That asymmetry is
 * deliberate. A wrongly removed heading costs a reader one navigation stop that
 * was misleading anyway; a wrongly invented one puts a claim about the
 * document's structure in front of someone who cannot check it. Demotion also
 * keeps the text: the node becomes a paragraph, so nothing disappears from the
 * document, it just stops claiming to be a section.
 *
 * ## Where the one promotion lives, and why not here
 *
 * The headings these documents actually have — 「１.」, 「■」 and 「◆」 lines —
 * cannot be recovered from pdf-inspector's output alone, because it **merges
 * them into the following paragraph**: the heading and the paragraph arrive as
 * one block. Promoting that would make the whole paragraph a heading, which is
 * useless; splitting it needs the
 * original line boundary, which the merge discarded — and which PDF.js still
 * has. `heading-promotion.ts` finds that boundary inside the merged block and
 * splits there, and its doc comment says why that is a promotion this project
 * is prepared to make when this file makes none: the split point is verified
 * against the document rather than guessed, and the shape it requires is the
 * one a sighted reader uses. It runs on the main thread, where PDF.js is,
 * which is why it is not part of this file's pass in the worker.
 *
 * Font size does not rescue it either. Measured with PDF.js on the fixtures:
 * the title and every numbered section are set at the **same size and the same
 * font resource as body text** (11pt `g_d0_f2`), and `getTextContent()` exposes
 * no weight at all — `styles` carries only a generic family and ascent/descent.
 * The underlined title is still not a heading in this reading: underline lives
 * in the content stream rather than in the text, and nothing here reads it.
 */

/**
 * The closing marker of a Japanese business letter. Extraction frequently
 * separates the two characters, so spacing is normalised before comparing.
 */
const CLOSING_MARKERS = new Set(['以上']);

/** A heading that is entirely a parenthetical is an aside, not a section. */
const FULLY_PARENTHESISED = /^[（(][^（(]*[）)]$/;

/**
 * Above this share of undecodable characters, the text is not a heading in any
 * useful sense — it is a page whose font carries no usable ToUnicode map, and
 * the page will already be reported as needing OCR.
 *
 * One untagged prospectus produces fourteen such headings, several of which
 * are a single replacement character. Announcing those in a heading list gives a
 * reader fourteen destinations and no information. A third is comfortably
 * below every garbled heading measured (all are near or at 100%) and above any
 * real one, which carry none at all.
 */
const GARBLED_SHARE = 1 / 3;

export function refineHeadings(nodes: DocumentNode[]): DocumentNode[] {
  return nodes.map((node) => {
    if (node.type !== 'heading' || !shouldDemote(inlineToPlainText(node.content))) {
      return node;
    }
    // The words stay; only the claim about them goes.
    return { type: 'paragraph', content: node.content };
  });
}

export function shouldDemote(text: string): boolean {
  const tight = text.replace(/\s+/gu, '');
  if (tight.length === 0) return false;
  if (CLOSING_MARKERS.has(tight) || FULLY_PARENTHESISED.test(tight)) return true;

  const garbled = [...tight].filter((character) => character === '\uFFFD').length;
  return garbled / tight.length >= GARBLED_SHARE;
}
