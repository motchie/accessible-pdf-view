/* tslint:disable */
/* eslint-disable */

export type PdfType = "TextBased" | "Scanned" | "ImageBased" | "Mixed";
export type MarkdownProfile = "fidelity" | "compact";

export interface ProcessOptions {
    /** Restrict extraction to these 1-indexed page numbers. */
    pages?: number[];
    /** Password for an encrypted PDF. */
    password?: string;
    /** Source-faithful output by default, or compact output for fewer tokens. */
    profile?: MarkdownProfile;
    /** Insert `<!-- Page N -->` markers between pages. */
    includePageMarkers?: boolean;
    /** Include image placeholders in Markdown output. */
    includeImages?: boolean;
}

export interface PageOcrReasons {
    /** 1-indexed page number. */
    page: number;
    reasons: string[];
}

/**
 * A font whose ToUnicode CMap — or, for a font without one, the embedded
 * program's cmap table — had no entry for some of the codes the document
 * shows through it, and what became of those codes.
 */
export interface FontCmapGaps {
    /** The font's /BaseFont name, or its resource name when it has none. */
    font: string;
    /** Codes shown through the font's CMap, repeats included: two-byte codes, or the bytes of a single-byte CMap. */
    codes: number;
    /** Codes without an entry that were read from the mapped codes around them. */
    interpolated: number;
    /** Codes without an entry that could not be read; each is a U+FFFD in the text. */
    unmapped: number;
}

export interface LayoutComplexity {
    isComplex: boolean;
    /** 1-indexed page numbers. */
    pagesWithTables: number[];
    /** 1-indexed page numbers. */
    pagesWithColumns: number[];
}

export interface PdfProcessResult {
    pdfType: PdfType;
    markdown?: string;
    pageCount: number;
    processingTimeMs: number;
    /** 1-indexed page numbers. */
    pagesNeedingOcr: number[];
    ocrReasonsByPage: PageOcrReasons[];
    title?: string;
    confidence: number;
    layout: LayoutComplexity;
    hasEncodingIssues: boolean;
    /**
     * Fonts whose ToUnicode CMap — or, for a font without one, the embedded
     * program's cmap table — lacked an entry for a code the document shows
     * through it. Always empty for `detectPdf`, which decodes no text;
     * otherwise empty when every such code had an entry.
     */
    cmapGaps: FontCmapGaps[];
}

export interface PdfClassification {
    pdfType: PdfType;
    pageCount: number;
    /** 0-indexed page numbers, matching the native Node.js API. */
    pagesNeedingOcr: number[];
    confidence: number;
}

export function processPdf(data: Uint8Array, options?: ProcessOptions): PdfProcessResult;
export function detectPdf(data: Uint8Array, options?: Pick<ProcessOptions, "password">): PdfProcessResult;
export function classifyPdf(data: Uint8Array): PdfClassification;
export function extractText(data: Uint8Array): string;
export function version(): string;



export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly classifyPdf: (a: number, b: number, c: number) => void;
    readonly detectPdf: (a: number, b: number, c: number, d: number) => void;
    readonly extractText: (a: number, b: number, c: number) => void;
    readonly processPdf: (a: number, b: number, c: number, d: number) => void;
    readonly version: (a: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
