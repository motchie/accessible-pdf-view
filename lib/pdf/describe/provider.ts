/**
 * Describing a figure.
 *
 * Deliberately *not* part of `OcrProvider`. OCR reads text that is already on
 * the page; this produces a description of a picture that no text in the
 * document supplies. They have different inputs, different failure modes, and —
 * most importantly — different truth status: an OCR error misreads something
 * that exists, a description error invents something that does not. Keeping
 * them apart is what lets the Reader label them differently.
 *
 * The whole point of this interface is the situation where the alternative is
 * silence: an untagged PDF where a screen reader user is told only that there
 * is an image and that no alternative text could be obtained. A description of
 * unknown
 * accuracy is more use than that — but only if the reader is told what it is.
 * That is why `DescribedFigure` has no path into `FigureNode.alternativeText`
 * without also setting `alternativeTextSource: 'generated'`.
 */
export interface FigureDescriber {
  readonly id: string;
  readonly displayName: string;
  /**
   * Whether describing an image sends it off the device. Chrome's built-in
   * model does not; a future hosted describer would, and the Reader must obtain
   * consent before running one — same rule as `OcrProvider`.
   */
  readonly sendsDataExternally: boolean;
  readonly experimental: boolean;
  /**
   * What the describer's model can actually use, so the caller does not render
   * more. Chrome's built-in model resizes every image to a fixed square;
   * anything larger is rendered and encoded only to be discarded.
   */
  readonly preferredImage?: { maxEdge?: number };

  /**
   * @param options.language BCP-47 tag of the document. Passed through because
   * availability is per-configuration — and because probing without declaring
   * an output language is itself a malformed request on Chrome's API.
   */
  isAvailable(options?: { language?: string }): Promise<DescriberAvailability>;
  describe(input: FigureImage, options?: DescribeOptions): Promise<DescribedFigure>;
  dispose?(): Promise<void>;
}

export type DescriberAvailability =
  | { status: 'available' }
  /** The engine exists but its model has to be downloaded first. Surfaced so
   * the UI can offer that rather than silently hiding the feature. */
  | { status: 'downloadable' }
  | { status: 'downloading' }
  /**
   * `reason` is a key, not a sentence.
   *
   * It used to be the sentence, which meant a provider — a module with no idea
   * what language the Reader is rendering in — was writing interface text. The
   * two cases are the two the Reader can say something useful about; anything
   * else a provider learns belongs in the console, not in a panel.
   */
  | { status: 'unavailable'; reason: 'unsupported-browser' | 'insufficient-hardware' };

export interface FigureImage {
  image: Blob;
  /** Where the figure sits, for progress reporting and for re-cropping. */
  pageNumber: number;
  /** Index of this figure among the figures on its page. */
  indexOnPage: number;
  /** Caption or nearby text the document already supplies. Given to the
   * describer as context — a caption often names what the picture shows. */
  caption?: string;
  /** BCP-47 tag the description should be written in. */
  language?: string;
}

export interface DescribeOptions {
  signal?: AbortSignal;
  onProgress?: (progress: { pageNumber: number; indexOnPage: number }) => void;
  /** Approximate ceiling for the description, in characters. Alternative text
   * is meant to be read aloud in one breath, not to be an essay. */
  maxLength?: number;
}

export interface DescribedFigure {
  /** Null when the describer judged the image to carry no information — a rule,
   * a background panel, a spacer. Announcing "a thin horizontal line" for page
   * furniture is worse than saying nothing. */
  description: string | null;
  /** True when the describer classified the image as decorative. */
  decorative: boolean;
  providerId: string;
  /**
   * What the engine actually replied, when that reply could not be turned into
   * a description. Carried so a failure can be reported rather than guessed at
   * — an empty result and a refusal look identical from the outside.
   */
  rawReply?: string;
}
