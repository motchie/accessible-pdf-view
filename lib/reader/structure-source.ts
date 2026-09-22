import type { DocumentOrigin } from '../pdf/document-model';
import type { StructureSource } from './settings';

/**
 * The words for these readings live in the message catalogue, at
 * `structure.sources`, because they are interface text and this module is
 * not — what remains here is which readings exist and which one a document
 * opens with. `pdf-text` is in the catalogue but never offered as a
 * whole-document reading (see `STRUCTURE_ORDER`): it exists per page, for
 * pages the chosen reading dropped entirely.
 */

/**
 * The order the readings are offered in: the author's answer with its gaps
 * filled, then the author's answer alone, then inference alone. The combined
 * reading is first because it is what the default opens with; it is absent
 * from most documents, and then the author's answer leads.
 */
export const STRUCTURE_ORDER: ReadonlyArray<StructureSource> = [
  'combined',
  'tagged-pdf',
  'pdf-inspector',
];

/**
 * Which reading to open with.
 *
 * The preference is honoured only where it can be: a document that produced one
 * reading has nothing to choose between, and saying otherwise would be a lie
 * about what is on screen. `available` is in offered order, so a preference for
 * the combined reading on a document that has none falls to the author's own
 * answer, not to inference.
 */
export function initialStructureSource(
  available: ReadonlyArray<DocumentOrigin>,
  preference: StructureSource,
): DocumentOrigin | null {
  if (available.length === 0) return null;
  return available.includes(preference) ? preference : (available[0] ?? null);
}
