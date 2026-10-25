// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { processPdf, type PdfProcessResult } from '@firecrawl/pdf-inspector-wasm';
import { adaptInspectorResult } from '../lib/pdf/inspector/adapter';
import type { InspectorRawResult } from '../lib/pdf/inspector/protocol';
import { buildMinimalPdf } from './helpers/minimal-pdf';

/**
 * The mirror in protocol.ts and the package's own declaration, held together by
 * the compiler: the same keys at every level — the result, the objects inside
 * it, the elements of its arrays — and each side assignable to the other.
 * Assignability alone is not enough: an optional field the package adds leaves
 * both directions assignable, which is how 1.24's document-information fields
 * went unnoticed until keys were compared, and comparing only the top level
 * would miss the same thing one object down. Checked at compile time only;
 * nothing here runs.
 */
type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false;
type Assignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AllTrue<T> = [T] extends [true] ? true : false;
type DeepSame<A, B> = [A] extends [readonly (infer EA)[]]
  ? [B] extends [readonly (infer EB)[]]
    ? DeepSame<EA, EB>
    : false
  : [A] extends [object]
    ? [B] extends [object]
      ? SameKeys<A, B> extends true
        ? AllTrue<{ [K in keyof A & keyof B]-?: DeepSame<A[K], B[K]> }[keyof A & keyof B]>
        : false
      : false
    : Assignable<A, B>;
// Assignability of the whole also settles which fields are optional.
type Same<A, B> = DeepSame<A, B> extends true ? Assignable<A, B> : false;
const mirrorMatchesPackage: Same<InspectorRawResult, PdfProcessResult> = true;
void mirrorMatchesPackage;

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

  /**
   * The reason this build is not npm's (vendor/pdf-inspector-wasm/README.md).
   *
   * A CID font with neither an embedded program nor a ToUnicode CMap can only
   * be read through its character collection's own mapping, which pdf-inspector
   * keeps as pdf.js's binary CMaps; without firecrawl/pdf-inspector#594 they
   * do not parse, and every character comes back as U+FFFD. npm's 1.25.2 reads
   * this line as three of them. CID 7641 is 𨳝 (U+28CDD), outside the BMP,
   * which the fix's second commit is for. poppler reads the same three.
   */
  it('reads a CID font with no ToUnicode through its collection, outside the BMP too', () => {
    const pdf = buildMinimalPdf({
      pages: [['A line of body text long enough to read as a paragraph here.']],
      japan1Cids: [843, 7641, 843],
    });

    const result = processPdf(pdf, PROCESS_OPTIONS) as unknown as InspectorRawResult;

    expect(result.markdown).toContain('あ\u{28CDD}あ');
    expect(result.markdown).not.toContain('\uFFFD');
  });
});
