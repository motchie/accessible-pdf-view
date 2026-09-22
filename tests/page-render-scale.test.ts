import { describe, expect, it } from 'vitest';
import { MODEL_IMAGE_EDGE } from '../lib/ai/chrome-session';
import { pageRenderScale } from '../lib/pdf/pdfjs/page-image';

/**
 * A4 in PDF user-space units (1/72 inch), as the MediaBox of the document in
 * the report was written: a whole-number height, which is what makes the
 * numbers below come out exactly as Chrome reported them.
 */
const A4 = { width: 595.28, height: 842 };

describe('choosing a page render scale', () => {
  it('renders at the requested DPI when nothing caps it', () => {
    expect(pageRenderScale(A4.width, A4.height, { dpi: 300 })).toBeCloseTo(300 / 72, 10);
  });

  /**
   * The measurement behind the cap. Chrome's built-in model reports:
   *
   *   Image input (2480x3508) will be downscaled to 768x768.
   *
   * 2480x3508 is exactly this page at 300 DPI — 8.7 megapixels rendered,
   * encoded and handed over so the model could read 0.59 of them.
   */
  it('is what produced the 2480x3508 the model threw away', () => {
    const scale = pageRenderScale(A4.width, A4.height, { dpi: 300 });
    expect(Math.floor(A4.width * scale)).toBe(2480);
    expect(Math.floor(A4.height * scale)).toBe(3508);
  });

  it('caps the longer edge at what the consumer reads', () => {
    const scale = pageRenderScale(A4.width, A4.height, {
      dpi: 300,
      maxEdge: MODEL_IMAGE_EDGE,
    });
    const width = Math.floor(A4.width * scale);
    const height = Math.floor(A4.height * scale);

    expect(height).toBe(MODEL_IMAGE_EDGE);
    expect(width).toBeLessThan(MODEL_IMAGE_EDGE);
    // Two orders of magnitude of rendering, encoding and memory, for pixels
    // that were discarded on arrival.
    expect((width * height) / (2480 * 3508)).toBeLessThan(0.07);
  });

  it('caps the longer edge whichever edge that is', () => {
    const scale = pageRenderScale(A4.height, A4.width, { dpi: 300, maxEdge: 768 });
    expect(Math.floor(A4.height * scale)).toBe(768);
  });

  /**
   * A real OCR engine wants the resolution, and says so by leaving the cap
   * unset. It must never be capped by accident.
   */
  it('never scales up, and never caps a provider that did not ask', () => {
    // Already smaller than the cap: the DPI still decides.
    expect(pageRenderScale(72, 72, { dpi: 96, maxEdge: 768 })).toBeCloseTo(96 / 72, 10);
    expect(pageRenderScale(A4.width, A4.height, { dpi: 300 })).toBeGreaterThan(
      pageRenderScale(A4.width, A4.height, { dpi: 300, maxEdge: 768 }),
    );
  });
});
