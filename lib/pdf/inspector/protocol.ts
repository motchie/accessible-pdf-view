import type { AccessibleDocument, PdfCapabilities } from '../document-model';
import type { SerializedPdfError } from '../errors';

/**
 * Messages exchanged with the pdf-inspector worker.
 *
 * The PDF bytes and the processing options go in; a Document Model comes back.
 * The worker resolves its own WASM module (see worker.ts), so nothing here
 * depends on an extension API and the protocol stays testable in plain Node.
 *
 * **The Document Model, not the raw result.** Lowering pdf-inspector's Markdown
 * into the model means parsing it, and micromark is real work — measured at
 * 58 ms on a 29-page deck and growing with the document. That used to run on
 * the Reader's thread, which contradicts the rule the rest of this project
 * follows: expensive work goes to a worker so the UI and the live region that
 * announces progress keep responding. Moving it here also keeps the Markdown
 * parser out of the Reader's bundle entirely.
 */

/** Mirrors `ProcessOptions` from @firecrawl/pdf-inspector-wasm. */
export interface InspectorProcessOptions {
  pages?: number[];
  password?: string;
  profile?: 'fidelity' | 'compact';
  includePageMarkers?: boolean;
  includeImages?: boolean;
}

export interface InspectorRequest {
  type: 'analyze';
  requestId: number;
  bytes: ArrayBuffer;
  options: InspectorProcessOptions;
  /** Recorded in the document's metadata. The worker builds the document, so it
   * needs this; it never fetches anything. */
  sourceUrl?: string | null;
}

/** Mirrors `PdfProcessResult` from @firecrawl/pdf-inspector-wasm 0.1.3. */
export interface InspectorRawResult {
  pdfType: 'TextBased' | 'Scanned' | 'ImageBased' | 'Mixed';
  markdown?: string;
  pageCount: number;
  processingTimeMs: number;
  /** 1-indexed page numbers. */
  pagesNeedingOcr: number[];
  ocrReasonsByPage: Array<{ page: number; reasons: string[] }>;
  title?: string;
  confidence: number;
  layout: {
    isComplex: boolean;
    pagesWithTables: number[];
    pagesWithColumns: number[];
  };
  hasEncodingIssues: boolean;
}

/**
 * The options the Reader asks pdf-inspector for, and why.
 *
 * - `includePageMarkers` gives us `<!-- Page N -->` comments, which is the only
 *   way to attribute Markdown blocks back to PDF pages. Per-page attribution is
 *   what makes mixed PDFs (some text pages, some scanned) assemblable.
 * - `includeImages` surfaces image placeholders so the Reader can tell a screen
 *   reader user that a figure exists at all.
 * - `fidelity` keeps the output source-faithful; `compact` exists to reduce
 *   token counts for LLM pipelines, which is not what this project is for.
 *
 * Declared here rather than in the adapter so that the main thread can name the
 * options without importing the adapter — and with it the Markdown parser.
 */
export const READER_PROCESS_OPTIONS: InspectorProcessOptions = {
  profile: 'fidelity',
  includePageMarkers: true,
  includeImages: true,
};

/**
 * What the worker sends back.
 *
 * A plain object graph, so it crosses the structured-clone boundary as-is.
 */
export interface InspectorAdaptation {
  document: AccessibleDocument;
  capabilities: PdfCapabilities;
  /** The Markdown exactly as pdf-inspector produced it, for the Markdown view. */
  markdown: string | null;
}

export type InspectorResponse =
  | { type: 'result'; requestId: number; result: InspectorAdaptation }
  | { type: 'error'; requestId: number; error: SerializedPdfError };
