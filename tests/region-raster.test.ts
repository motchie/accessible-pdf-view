import { describe, expect, it } from 'vitest';
import { displayDpi } from '../lib/pdf/pdfjs/region-raster';

const box = (width: number, height: number) => ({ x: 0, y: 0, width, height });
const pixels = (points: number, dpi: number) => (points * dpi) / 72;

/**
 * How finely a figure is rendered for display (#15). A figure shown although
 * it is small must still be big enough to make out, without a thin, wide one
 * turning into an enormous image.
 */
describe('displayDpi', () => {
  it('renders an ordinary figure at two pixels to the point', () => {
    expect(displayDpi(box(200, 120))).toBe(144);
    expect(displayDpi(box(24, 24))).toBe(144);
  });

  it('renders a small figure finely enough that its shorter side is 48 pixels', () => {
    expect(pixels(10, displayDpi(box(10, 10)))).toBeCloseTo(48);
    expect(pixels(4, displayDpi(box(4, 8)))).toBeCloseTo(48);
  });

  it('caps the longer side of a thin, wide figure', () => {
    // PowerPoint's grouped route: 224 x 4pt.
    const dpi = displayDpi(box(224, 4));
    expect(pixels(224, dpi)).toBeLessThanOrEqual(1200);
    expect(dpi).toBeGreaterThanOrEqual(144);
  });
});
