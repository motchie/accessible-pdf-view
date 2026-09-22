// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * The icons are measured, not eyeballed.
 *
 * The mark's coordinates exist for one reason: every edge lands on a pixel
 * boundary at each shipped size, so the render is crisp rather than a field of
 * half-tones. That property is invisible in review and degrades silently — a
 * nudged coordinate, or someone regenerating 16px by downscaling the 128px
 * master, and the toolbar icon goes soft with nothing to notice.
 *
 * So this reads the actual PNGs and counts pixels. Measured on the committed
 * files: 77% of painted pixels fully opaque at 16px, rising to 96% at 128px.
 * The floors below sit under those with room for honest variation.
 */
const SIZES = [16, 32, 48, 96, 128] as const;

/** Below this share of fully-opaque pixels, an edge has slipped off the grid. */
const MINIMUM_OPAQUE_SHARE: Record<number, number> = {
  16: 0.7,
  32: 0.8,
  48: 0.8,
  96: 0.9,
  128: 0.9,
};

interface Png {
  width: number;
  height: number;
  alpha: number[];
}

/** Just enough PNG to check the encoder's own output: 8-bit RGBA, no interlace,
 * every scanline written with filter 0 — which is what make-icons.mjs emits. */
function readPng(path: string): Png {
  const buffer = readFileSync(path);
  expect(buffer.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );

  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8], 'bit depth').toBe(8);
      expect(data[9], 'colour type (6 = RGBA)').toBe(6);
      expect(data[12], 'interlace').toBe(0);
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  const alpha: number[] = [];
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride], `scanline ${y} filter`).toBe(0);
    for (let x = 0; x < width; x++) alpha.push(raw[y * stride + 1 + x * 4 + 3]!);
  }
  return { width, height, alpha };
}

const iconPath = (size: number) => resolve(`public/icon/${size}.png`);

describe('the shipped extension icons', () => {
  it.each(SIZES)('public/icon/%i.png exists', (size) => {
    expect(existsSync(iconPath(size))).toBe(true);
  });

  it.each(SIZES)('public/icon/%i.png really is that size', (size) => {
    const png = readPng(iconPath(size));
    expect([png.width, png.height]).toEqual([size, size]);
  });

  /**
   * The one that matters. A downscaled or nudged mark still renders — it just
   * renders soft, and at 16px soft means the frame sinks into the background
   * while the route stays black.
   */
  it.each(SIZES)('public/icon/%i.png stays crisp', (size) => {
    const { alpha } = readPng(iconPath(size));
    const painted = alpha.filter((a) => a > 0);
    const opaque = painted.filter((a) => a === 255);

    expect(painted.length, 'the icon is not blank').toBeGreaterThan(0);
    expect(opaque.length / painted.length).toBeGreaterThanOrEqual(
      MINIMUM_OPAQUE_SHARE[size]!,
    );
  });

  /** Transparent, not white — a white plate would show as a box on a dark
   * toolbar. */
  it('leaves the background transparent', () => {
    const { alpha } = readPng(iconPath(128));
    expect(alpha.filter((a) => a === 0).length).toBeGreaterThan(0);
  });
});

/**
 * The packaged typeface.
 *
 * The typeface setting used to be a control that could do nothing: it named
 * faces and hoped the reader had them. Atkinson Hyperlegible now ships in the
 * extension, which is the difference between an offer and a guarantee — and a
 * file that quietly stops being copied would take the guarantee with it while
 * the settings panel went on promising it.
 *
 * The licence is checked beside the fonts because shipping the one without the
 * other is the thing the OFL actually forbids.
 */
describe('the packaged typeface', () => {
  const FONTS = [
    'AtkinsonHyperlegibleNext-Variable.ttf',
    'AtkinsonHyperlegibleNext-Italic-Variable.ttf',
  ];

  it('ships both the upright and the italic', () => {
    for (const name of FONTS) {
      const file = resolve(import.meta.dirname, '..', 'public/fonts', name);
      expect(existsSync(file), name).toBe(true);
      // Real font, not a placeholder or a truncated download.
      const bytes = readFileSync(file);
      expect(bytes.byteLength, name).toBeGreaterThan(50_000);
      // TrueType's own magic number, `0x00010000`.
      expect([...bytes.subarray(0, 4)], name).toEqual([0, 1, 0, 0]);
    }
  });

  it('ships the licence the font is used under', () => {
    const licence = readFileSync(
      resolve(import.meta.dirname, '..', 'public/fonts/OFL.txt'),
      'utf8',
    );
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(licence).toContain('Atkinson Hyperlegible Next Project Authors');
  });
});
