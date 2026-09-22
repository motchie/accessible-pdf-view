import { deserializePdfError, PdfError } from '../errors';
import type {
  InspectorAdaptation,
  InspectorProcessOptions,
  InspectorRequest,
  InspectorResponse,
} from './protocol';

/**
 * Main-thread handle to the pdf-inspector worker.
 *
 * Owns the worker lifecycle and the request/response correlation. There is no
 * browser-extension API in here at all, which is what lets the parsing path be
 * exercised outside an extension context.
 */

export interface InspectorAnalyzeOptions extends InspectorProcessOptions {
  signal?: AbortSignal;
  /** Recorded in the resulting document's metadata. */
  sourceUrl?: string | null;
}

export class InspectorClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;

  private getWorker(): Worker {
    this.worker ??= new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
      name: 'pdf-inspector',
    });
    return this.worker;
  }

  /**
   * Runs pdf-inspector over the bytes and returns a Document Model.
   *
   * The adaptation happens in the worker, not here: it parses Markdown, and the
   * Reader's thread has a live region to keep answering. pdf-inspector's own
   * Markdown comes back alongside the model, so the Markdown view still has the
   * unmodified output to show.
   */
  async analyze(
    bytes: ArrayBuffer,
    options: InspectorAnalyzeOptions = {},
  ): Promise<InspectorAdaptation> {
    const { signal, sourceUrl, ...processOptions } = options;
    const worker = this.getWorker();
    const requestId = this.nextRequestId++;

    return new Promise<InspectorAdaptation>((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };

      const onMessage = (event: MessageEvent<InspectorResponse>) => {
        const message = event.data;
        if (message?.requestId !== requestId) return;
        cleanup();
        if (message.type === 'result') {
          resolve(message.result);
        } else {
          reject(deserializePdfError(message.error));
        }
      };

      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(
          new PdfError('parse-failed', 'engine-failed', {
            detail: event.message,
          }),
        );
      };

      const onAbort = () => {
        cleanup();
        // The worker cannot interrupt a synchronous WASM call, so the only way
        // to actually stop the work is to discard the worker.
        this.terminate();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });

      const request: InspectorRequest = {
        type: 'analyze',
        requestId,
        bytes,
        options: processOptions,
        sourceUrl: sourceUrl ?? null,
      };
      // Transferring avoids copying a multi-megabyte buffer. The caller must
      // not use `bytes` afterwards; callers that need the bytes again (Original
      // mode) pass a copy.
      worker.postMessage(request, [bytes]);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
