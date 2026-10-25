/**
 * `Math.sumPrecise` for Node, which does not have it yet.
 *
 * PDF.js 6's modern build — the one the extension ships — calls it while
 * converting embedded fonts. Chrome has it from 147 and Firefox from 137;
 * Node 26 does not. Without it, every embedded font fails to load, PDF.js
 * falls back to a substitute, and the text it extracts is no longer what a
 * browser gets: a vertical CID font's 、 comes back as ︑ (U+FE11), for one.
 * The tests would then be checking a reading no supported browser produces.
 *
 * Exact, not approximate: the partial sums are kept without rounding error
 * (Shewchuk's algorithm, as Python's `math.fsum`), so the result is the
 * correctly rounded sum the specification asks for. Installed only where the
 * runtime lacks it, so it steps aside once Node catches up.
 */
function sumPrecise(items: Iterable<number>): number {
  const partials: number[] = [];
  let sawInfinity = 0;
  let sawNaN = false;
  let count = 0;

  for (const item of items) {
    if (typeof item !== 'number') throw new TypeError('Math.sumPrecise: every item must be a number');
    count++;
    if (Number.isNaN(item)) {
      sawNaN = true;
      continue;
    }
    if (!Number.isFinite(item)) {
      if (sawInfinity && Math.sign(item) !== Math.sign(sawInfinity)) sawNaN = true;
      sawInfinity = item;
      continue;
    }
    let x = item;
    let kept = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const high = x + y;
      const low = y - (high - x);
      if (low !== 0) partials[kept++] = low;
      x = high;
    }
    partials.length = kept;
    partials.push(x);
  }

  if (sawNaN) return NaN;
  if (sawInfinity) return sawInfinity;
  // The empty sum is -0, as the specification has it; so is a sum of -0s.
  if (count === 0 || partials.every((value) => Object.is(value, -0))) return -0;

  // Add the partials from the largest down, correcting the last rounding when
  // the remainder would have tipped it (the tail of Python's fsum).
  let index = partials.length - 1;
  let high = partials[index]!;
  let low = 0;
  while (index > 0) {
    const x = high;
    const y = partials[--index]!;
    high = x + y;
    low = y - (high - x);
    if (low !== 0) break;
  }
  if (index > 0 && ((low < 0 && partials[index - 1]! < 0) || (low > 0 && partials[index - 1]! > 0))) {
    const y = low * 2;
    const x = high + y;
    if (y === x - high) high = x;
  }
  return high;
}

if (typeof (Math as { sumPrecise?: unknown }).sumPrecise !== 'function') {
  Object.defineProperty(Math, 'sumPrecise', {
    value: sumPrecise,
    writable: true,
    configurable: true,
  });
}
