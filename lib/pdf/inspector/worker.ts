/// <reference lib="webworker" />
import init, { processPdf } from '@firecrawl/pdf-inspector-wasm';
// The `?url` import makes the bundler emit the 4.8 MB module once and hands
// back its final, hashed path. Letting wasm-bindgen's own default
// (`new URL('pdf_inspector_wasm_bg.wasm', import.meta.url)`) resolve it works
// too, but then the path is implicit and a second copy in `public/` would be
// shipped alongside it. The URL is root-relative, so it resolves against the
// extension's own origin — which is the only origin `script-src 'self'` and
// this project's privacy model allow.
import wasmUrl from '@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm?url';
import { PdfError, serializePdfError } from '../errors';
import { adaptInspectorResult } from './adapter';
import type { InspectorRawResult, InspectorRequest, InspectorResponse } from './protocol';

/**
 * Runs pdf-inspector's WebAssembly core off the main thread.
 *
 * `processPdf` is synchronous once the module is initialised, and it can take
 * seconds on a large document — running it on the Reader's thread would freeze
 * the UI and, worse, stall the live region that announces progress to a screen
 * reader.
 *
 * The PDF bytes arrive as a transferred ArrayBuffer and never leave this
 * worker: pdf-inspector performs no network access, so opening a document
 * causes no outbound traffic of any kind.
 *
 * What goes back is the Document Model, not the raw result. Lowering one into
 * the other means parsing Markdown, which is itself tens of milliseconds and
 * grows with the document — the same reason the WASM call is here.
 */

let ready: Promise<unknown> | null = null;

function ensureInitialized(): Promise<unknown> {
  // wasm-bindgen's init is idempotent, but keeping the promise avoids racing
  // two fetches of a 4.8 MB module when requests overlap.
  ready ??= init({ module_or_path: wasmUrl });
  return ready;
}

self.onmessage = async (event: MessageEvent<InspectorRequest>) => {
  const request = event.data;
  if (request?.type !== 'analyze') return;

  try {
    await ensureInitialized();

    const raw = processPdf(
      new Uint8Array(request.bytes),
      request.options,
    ) as unknown as InspectorRawResult;

    const response: InspectorResponse = {
      type: 'result',
      requestId: request.requestId,
      // A plain object graph either way, so it crosses the structured-clone
      // boundary as-is.
      result: adaptInspectorResult(raw, request.sourceUrl ?? null),
    };
    self.postMessage(response);
  } catch (cause) {
    const error =
      cause instanceof PdfError
        ? cause
        : new PdfError('parse-failed', 'parse-failed', {
            detail: cause instanceof Error ? cause.message : String(cause),
            cause,
          });

    const response: InspectorResponse = {
      type: 'error',
      requestId: request.requestId,
      error: serializePdfError(error),
    };
    self.postMessage(response);
  }
};
