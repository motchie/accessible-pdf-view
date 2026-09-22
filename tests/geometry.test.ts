import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  applyMatrix,
  gap,
  intersectsPage,
  multiply,
  touches,
  transformedBounds,
  union,
  unitSquareBounds,
  type Matrix,
} from '../lib/pdf/geometry';
import { fileNameFromUrl, readParams } from '../lib/reader/params';

/**
 * The geometry used to live inside the figure locator, tangled with
 * content-stream walking and canvas rasterisation, and could only be tested
 * through a real PDF. It is the part most easily got wrong — every figure
 * mis-placement this project has had traced back to it — so it is now the part
 * that can be checked directly.
 */
describe('matrices', () => {
  it('leaves a point alone under the identity', () => {
    expect(applyMatrix(IDENTITY, 3, 7)).toEqual([3, 7]);
  });

  it('applies the left matrix first', () => {
    const scale: Matrix = [2, 0, 0, 2, 0, 0];
    const translate: Matrix = [1, 0, 0, 1, 10, 20];

    // Scale, then translate: the translation is not scaled.
    expect(applyMatrix(multiply(scale, translate), 1, 1)).toEqual([12, 22]);
    // Translate, then scale: it is.
    expect(applyMatrix(multiply(translate, scale), 1, 1)).toEqual([22, 42]);
  });

  /**
   * The form-XObject bug in miniature. A real document nested its figures in
   * forms scaled by 0.09; ignoring the form's matrix put them roughly ten times
   * too large and far off the page.
   */
  it('composes a nested transform rather than replacing it', () => {
    const outer: Matrix = [0.09, 0, 0, 0.09, 0, 0];
    const inner: Matrix = [100, 0, 0, 50, 10, 20];

    const bounds = unitSquareBounds(multiply(inner, outer));
    expect(bounds.width).toBeCloseTo(9);
    expect(bounds.height).toBeCloseTo(4.5);
  });
});

describe('bounds', () => {
  it('measures the unit square under a placement matrix', () => {
    expect(unitSquareBounds([200, 0, 0, 100, 50, 60])).toEqual({
      x: 50,
      y: 60,
      width: 200,
      height: 100,
    });
  });

  /** Two opposite corners would describe the wrong box once a matrix rotates
   * or flips, which is why all four are transformed. */
  it('survives a 90-degree rotation', () => {
    const rotate: Matrix = [0, 1, -1, 0, 0, 0];
    const bounds = unitSquareBounds(multiply([200, 0, 0, 100, 0, 0], rotate));

    expect(bounds.width).toBeCloseTo(100);
    expect(bounds.height).toBeCloseTo(200);
  });

  it('survives a vertical flip', () => {
    const bounds = transformedBounds([1, 0, 0, -1, 0, 0], 0, 0, 10, 20);
    expect(bounds).toEqual({ x: 0, y: -20, width: 10, height: 20 });
  });

  it('unions two boxes into one that holds both', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 20, y: 5, width: 10, height: 10 };
    expect(union(a, b)).toEqual({ x: 0, y: 0, width: 30, height: 15 });
  });
});

describe('separation', () => {
  it('reports zero gap for overlapping boxes', () => {
    expect(
      gap({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }),
    ).toBe(0);
  });

  it('measures along whichever axis separates them', () => {
    // 30pt apart horizontally, 0 vertically — the larger wins.
    expect(
      gap({ x: 0, y: 0, width: 10, height: 10 }, { x: 40, y: 0, width: 10, height: 10 }),
    ).toBe(30);
  });

  /** Tiles butt up rather than overlap, and exact edges rarely survive
   * floating point — hence the tolerance. */
  it('treats boxes a hair apart as touching', () => {
    expect(
      touches({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 10, height: 10 }),
    ).toBe(true);
    expect(
      touches({ x: 0, y: 0, width: 10, height: 10 }, { x: 40, y: 0, width: 10, height: 10 }),
    ).toBe(false);
  });

  /** The backstop for any transform the walker does not model: a region off
   * the page would crop to a blank image. */
  it('rejects a box entirely outside the page', () => {
    expect(intersectsPage({ x: 700, y: 0, width: 50, height: 50 }, 595, 842)).toBe(false);
    expect(intersectsPage({ x: -60, y: 0, width: 50, height: 50 }, 595, 842)).toBe(false);
    expect(intersectsPage({ x: -10, y: 0, width: 50, height: 50 }, 595, 842)).toBe(true);
  });
});

describe('reader parameters', () => {
  it('reads the handoff and source URL', () => {
    expect(readParams('?src=https%3A%2F%2Fexample.com%2Fa.pdf&handoff=abc')).toEqual({
      sourceUrl: 'https://example.com/a.pdf',
      handoffId: 'abc',
      error: null,
    });
  });

  it('turns an error the background worker reported back into a PdfError', () => {
    const params = readParams('?error=fetch-failed&errorKey=fetch-failed&errorDetail=HTTP%20500');
    expect(params.error?.code).toBe('fetch-failed');
    // The key travels, not the sentence: the Reader picks the words, in the
    // language it is rendering in.
    expect(params.error?.messageKey).toBe('fetch-failed');
    expect(params.error?.detail).toBe('HTTP 500');
    expect(params.sourceUrl).toBeNull();
  });

  it('refuses a message key this build does not know', () => {
    // The URL is user-editable. An unknown key must not become an undefined
    // sentence in front of a reader.
    const params = readParams('?error=fetch-failed&errorKey=not-a-real-key');
    expect(params.error?.messageKey).toBe('unknown');
  });

  it('treats empty parameters as absent', () => {
    expect(readParams('?src=&handoff=')).toMatchObject({
      sourceUrl: null,
      handoffId: null,
    });
  });

  it('names the tab from the file when the PDF declares no title', () => {
    expect(fileNameFromUrl('https://example.com/docs/report.pdf')).toBe('report.pdf');
    expect(fileNameFromUrl('https://example.com/%E8%B3%87%E6%96%99.pdf')).toBe('資料.pdf');
    expect(fileNameFromUrl('https://example.com/')).toBeNull();
    expect(fileNameFromUrl('not a url')).toBeNull();
    expect(fileNameFromUrl(null)).toBeNull();
  });
});
