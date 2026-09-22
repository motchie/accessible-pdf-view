// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { processPdf } from '@firecrawl/pdf-inspector-wasm';
import { adaptInspectorResult } from '../lib/pdf/inspector/adapter';
import type { InspectorRawResult } from '../lib/pdf/inspector/protocol';
import { buildMinimalPdf } from './helpers/minimal-pdf';

/**
 * Runs the real pdf-inspector WebAssembly module.
 *
 * The adapter tests above use synthetic results, which means they would keep
 * passing if pdf-inspector's output shape changed underneath us. This one runs
 * the actual Rust core, so the assumptions the adapter is built on — page
 * markers, the classification fields, and above all "empty output means OCR is
 * needed, not that parsing failed" — are checked against the real thing.
 */
const wasmPath = fileURLToPath(
  new URL('../node_modules/@firecrawl/pdf-inspector-wasm/pdf_inspector_wasm_bg.wasm', import.meta.url),
);

const PROCESS_OPTIONS = {
  profile: 'fidelity' as const,
  includePageMarkers: true,
  includeImages: true,
};

beforeAll(async () => {
  await init({ module_or_path: await readFile(wasmPath) });
});

describe('pdf-inspector WASM', () => {
  it('classifies a text PDF and emits per-page Markdown', () => {
    const pdf = buildMinimalPdf({
      title: 'Quarterly Report',
      pages: [
        ['Quarterly Report', 'This is the first paragraph of body text.'],
        ['Facility Information', 'Address: 1-2-3 Example, Tokyo'],
      ],
    });

    const result = processPdf(pdf, PROCESS_OPTIONS) as unknown as InspectorRawResult;

    expect(result.pdfType).toBe('TextBased');
    expect(result.pageCount).toBe(2);
    expect(result.title).toBe('Quarterly Report');
    expect(result.markdown).toContain('<!-- Page 1 -->');
    expect(result.markdown).toContain('<!-- Page 2 -->');
  });

  it('feeds a real result through the adapter into per-page Document Model pages', () => {
    const pdf = buildMinimalPdf({
      pages: [
        ['Page One Heading', 'Body text on page one.'],
        ['Page Two Heading', 'Body text on page two.'],
      ],
    });

    const result = processPdf(pdf, PROCESS_OPTIONS) as unknown as InspectorRawResult;
    const { document, capabilities } = adaptInspectorResult(result, 'https://example.com/d.pdf');

    expect(document.pages).toHaveLength(2);
    expect(document.pages[0]!.nodes.length).toBeGreaterThan(0);
    expect(document.pages[1]!.nodes.length).toBeGreaterThan(0);
    expect(capabilities.hasExtractableText).toBe(true);
    expect(capabilities.requiresOcr).toBe(false);
  });

  it('reports a page with no extractable text as needing OCR, with empty Markdown', () => {
    // A page whose only content is whitespace stands in for a scanned page:
    // the parser succeeds, and there is simply no text to be had.
    const pdf = buildMinimalPdf({ pages: [[' ']] });

    const result = processPdf(pdf, PROCESS_OPTIONS) as unknown as InspectorRawResult;
    const { document, capabilities } = adaptInspectorResult(result, null);

    expect(result.pagesNeedingOcr).toContain(1);
    expect(result.markdown?.trim() ?? '').toBe('');

    // The point of the whole exercise: this is a document state, not an error.
    expect(capabilities.requiresOcr).toBe(true);
    expect(capabilities.hasExtractableText).toBe(false);
    expect(document.pages[0]!.status).toBe('requires-ocr');
  });
});
