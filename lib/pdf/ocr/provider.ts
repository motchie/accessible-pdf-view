/**
 * The OCR provider interface.
 *
 * OCR sits in the architecture from day one even though the MVP ships no
 * production OCR engine, because retrofitting it later would force changes
 * through the Document Model and the Reader. A provider takes page images and
 * returns *structured* blocks — never a flat string.
 *
 * Why not `plainText: string`: the point of this project is document structure.
 * A provider that can report headings, tables and reading order should be able
 * to, and the model must not throw that away. `OcrUnknown` exists so a
 * text-only engine remains a first-class provider without pretending to know
 * more than it does.
 */

export interface OcrProvider {
  readonly id: string;
  /** Shown in the UI when a provider is selectable. */
  readonly displayName: string;
  /**
   * Whether using this provider sends document content off the device. The
   * Reader must obtain explicit consent before running any provider where this
   * is true, and no such provider is bundled in the MVP.
   */
  readonly sendsDataExternally: boolean;
  /** Experimental providers are labelled as such and never presented as
   * production-quality output. */
  readonly experimental: boolean;
  /**
   * What the provider can actually use, so the caller does not render more.
   *
   * A model that resizes every input to a fixed square reads none of the extra
   * pixels in a 300 DPI page, and the render, the PNG encode and the memory are
   * all spent anyway. Providers that genuinely want the resolution — a real OCR
   * engine does — simply leave this unset.
   */
  readonly preferredImage?: { maxEdge?: number };

  /** @param options.languages BCP-47 tags the document is expected to be in.
   * Some engines report availability per language. */
  isAvailable(options?: { languages?: string[] }): Promise<boolean>;
  analyze(input: OcrInput, options?: OcrOptions): Promise<OcrResult>;
  dispose?(): Promise<void>;
}

export interface OcrInput {
  pages: OcrPageInput[];
}

export interface OcrPageInput {
  /** 1-indexed, matching the Document Model. */
  pageNumber: number;
  image: Blob | ArrayBuffer;
  width?: number;
  height?: number;
}

export interface OcrOptions {
  /** BCP-47 language hints, best-effort. */
  languages?: string[];
  signal?: AbortSignal;
  onProgress?: (progress: OcrProgress) => void;
}

export interface OcrProgress {
  pageNumber: number;
  /** 0..1 for the page currently being processed. */
  ratio: number;
}

export interface OcrResult {
  providerId: string;
  pages: OcrPageResult[];
}

export interface OcrPageResult {
  pageNumber: number;
  blocks: OcrBlock[];
  /** 0..1, when the engine reports one. Surfaced so the Reader can be honest
   * about low-quality recognition instead of presenting it as fact. */
  confidence?: number;
}

/**
 * Block types grow toward document structure. A text-only engine emits
 * `OcrParagraph` and `OcrUnknown`; a layout-analysis service can emit the rest.
 */
export type OcrBlock =
  | OcrHeading
  | OcrParagraph
  | OcrList
  | OcrTable
  | OcrFigure
  | OcrUnknown;

export interface OcrBlockBase {
  /** Position on the page in PDF user-space units, when the engine reports it.
   * Reading-order reconstruction and figure placement will need this. */
  bbox?: { x: number; y: number; width: number; height: number };
  confidence?: number;
}

export interface OcrHeading extends OcrBlockBase {
  type: 'heading';
  level: number;
  text: string;
}

export interface OcrParagraph extends OcrBlockBase {
  type: 'paragraph';
  text: string;
}

export interface OcrList extends OcrBlockBase {
  type: 'list';
  ordered: boolean;
  items: string[];
}

export interface OcrTable extends OcrBlockBase {
  type: 'table';
  /** Row-major. The first row is treated as a header when `hasHeader`. */
  rows: string[][];
  hasHeader?: boolean;
}

export interface OcrFigure extends OcrBlockBase {
  type: 'figure';
  /** Only ever text the engine actually read, e.g. a caption. The project does
   * not generate image descriptions. */
  caption?: string;
}

export interface OcrUnknown extends OcrBlockBase {
  type: 'unknown';
  text: string;
}
