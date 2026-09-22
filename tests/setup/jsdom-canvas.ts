/**
 * Minimal stubs for the canvas globals jsdom does not implement.
 *
 * PDF.js touches `DOMMatrix` and `Path2D` while its display module is being
 * evaluated, so merely importing anything that reaches `pdfjs-dist` throws in a
 * jsdom test — before a single line of our code runs.
 *
 * These are deliberately inert. No test here rasterises a page; the ones that
 * exercise real rendering run in the `node` environment against the fixture.
 * If a test ever depends on these behaving like the real thing, that test
 * belongs in the node environment instead of getting a richer fake.
 */
class StubDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: number[] | string) {
    if (Array.isArray(init) && init.length >= 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
    }
  }
}

class StubPath2D {
  addPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  rect(): void {}
  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
}

const globals = globalThis as Record<string, unknown>;

globals.DOMMatrix ??= StubDOMMatrix;
globals.Path2D ??= StubPath2D;
globals.ImageData ??= class {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
};

export {};
