import { processPdf } from '@firecrawl/pdf-inspector-wasm';
import { adaptInspectorResult } from './adapter';
import type { InspectorAdaptation, InspectorProcessOptions, InspectorRawResult } from './protocol';

/**
 * pdf-inspector's reading of a PDF, lowered to the Document Model.
 *
 * The WASM module must already be initialised. The inspector worker calls this
 * off the main thread; the outline tests call it in-process. Both getting the
 * reading from here is what keeps the tests' pdf-inspector reading the one the
 * extension produces.
 *
 * Kept out of `adapter.ts` on purpose: importing the WASM bindings there would
 * pull them into every bundle that only needs the adapter's helpers.
 */
export function analyzePdfBytes(
  bytes: Uint8Array,
  options: InspectorProcessOptions,
  sourceUrl: string | null,
): InspectorAdaptation {
  const raw = processPdf(bytes, options) as unknown as InspectorRawResult;
  return adaptInspectorResult(raw, sourceUrl);
}
