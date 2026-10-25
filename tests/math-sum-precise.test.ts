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
