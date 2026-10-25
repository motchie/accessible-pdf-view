// @vitest-environment node
import { describe, expect, it } from 'vitest';

/**
 * The setup's `Math.sumPrecise`, checked against what the specification
 * requires, so the tests' PDF.js does its arithmetic as a browser's does.
 */
const sumPrecise = (Math as unknown as { sumPrecise: (items: Iterable<number>) => number }).sumPrecise;

describe('Math.sumPrecise in the test environment', () => {
  it('exists, as PDF.js needs it to load embedded fonts', () => {
    expect(typeof sumPrecise).toBe('function');
  });

  it('adds without the rounding error of a running sum', () => {
    expect(sumPrecise([0.1, 0.2, 0.3])).toBe(0.6);
    expect([0.1, 0.2, 0.3].reduce((a, b) => a + b)).not.toBe(0.6);
    expect(sumPrecise([1e20, 0.1, -1e20])).toBe(0.1);
    expect(sumPrecise([1, 1e100, 1, -1e100])).toBe(2);
  });

  it('gets a finite answer when the running total would overflow', () => {
    expect(sumPrecise([1e308, 1e308, -1e308])).toBe(1e308);
    expect(sumPrecise([Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE])).toBe(Number.MAX_VALUE);
    expect(sumPrecise([-1e308, -1e308, 1e308])).toBe(-1e308);
    expect(sumPrecise([Number.MAX_VALUE, Number.MAX_VALUE])).toBe(Infinity);
    expect(sumPrecise([-Number.MAX_VALUE, -Number.MAX_VALUE])).toBe(-Infinity);
    // Half an ulp above the largest double rounds up to infinity; just under
    // half, it stays finite.
    expect(sumPrecise([Number.MAX_VALUE, 2 ** 970])).toBe(Infinity);
    expect(sumPrecise([Number.MAX_VALUE, 2 ** 970, -(2 ** 900)])).toBe(Number.MAX_VALUE);
  });

  it('follows the specification at the edges', () => {
    expect(Object.is(sumPrecise([]), -0)).toBe(true);
    expect(Object.is(sumPrecise([-0, -0]), -0)).toBe(true);
    expect(Object.is(sumPrecise([-0, 0]), 0)).toBe(true);
    expect(sumPrecise([Infinity, 1])).toBe(Infinity);
    expect(sumPrecise([Infinity, -Infinity])).toBeNaN();
    expect(sumPrecise([NaN, 1])).toBeNaN();
    expect(() => sumPrecise(['1' as unknown as number])).toThrow(TypeError);
  });

  it('sums integers exactly, which is most of what PDF.js asks of it', () => {
    expect(sumPrecise([4, 8, 12, 2 ** 52])).toBe(2 ** 52 + 24);
  });
});
