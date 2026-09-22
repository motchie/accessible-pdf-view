import type { BoundingBox } from './document-model';

/**
 * Rectangle and matrix arithmetic, in PDF user space.
 *
 * Pure and producer-free on purpose. This used to live inside the figure
 * locator, where it was tangled with content-stream walking and with canvas
 * rasterisation — three jobs that change for entirely different reasons. The
 * geometry is the part that is easiest to get wrong and easiest to test, so it
 * is the part that most deserves to stand alone.
 *
 * PDF user space has its origin at the bottom-left with y increasing upwards,
 * which is the opposite of the canvas. Nothing here flips: conversion happens
 * once, at the point where a region meets a viewport.
 */

/** `[a, b, c, d, e, f]`, the PDF transformation matrix. */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Matrix concatenation: apply `a`, then `b`. */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Axis-aligned bounds of a rectangle under `m`.
 *
 * All four corners are transformed, not two: a matrix may rotate or flip, and
 * two opposite corners would then describe the wrong box.
 */
export function transformedBounds(
  m: Matrix,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): BoundingBox {
  const corners = [
    applyMatrix(m, minX, minY),
    applyMatrix(m, maxX, minY),
    applyMatrix(m, minX, maxY),
    applyMatrix(m, maxX, maxY),
  ];
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** PDF paints an image into the unit square, positioned by the current matrix —
 * so the matrix alone carries both size and placement. */
export function unitSquareBounds(m: Matrix): BoundingBox {
  return transformedBounds(m, 0, 0, 1, 1);
}

export function union(a: BoundingBox, b: BoundingBox): BoundingBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Distance between two boxes along whichever axis separates them; zero when
 * they overlap. */
export function gap(a: BoundingBox, b: BoundingBox): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.max(dx, dy);
}

/** True when any part of the box lies within a page of this size. */
export function intersectsPage(bbox: BoundingBox, width: number, height: number): boolean {
  return (
    bbox.x < width && bbox.y < height && bbox.x + bbox.width > 0 && bbox.y + bbox.height > 0
  );
}

/** Tiles butt up against each other rather than overlapping, so a small
 * tolerance is needed — exact edges rarely survive floating point. */
const TOUCH_TOLERANCE_PT = 2;

export function touches(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x < b.x + b.width + TOUCH_TOLERANCE_PT &&
    b.x < a.x + a.width + TOUCH_TOLERANCE_PT &&
    a.y < b.y + b.height + TOUCH_TOLERANCE_PT &&
    b.y < a.y + a.height + TOUCH_TOLERANCE_PT
  );
}

/**
 * Below this in either dimension (PDF points, ~1/72 inch), a region is not a
 * figure. Hairline rules, spacer pixels and bullet glyphs are drawn as images
 * surprisingly often, and cropping one would produce noise.
 */
export const MIN_FIGURE_SIZE_PT = 24;
