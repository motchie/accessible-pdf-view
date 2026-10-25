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
 * (Shewchuk's algorithm, as Python's `math.fsum`), with the overflow handling
 * of the proposal's reference polyfill, so the result is the correctly rounded
 * sum the specification asks for even when a running total would pass the
 * largest double. Installed only where the runtime lacks it, so it steps aside
 * once Node catches up.
 */
const MAX_DOUBLE = Number.MAX_VALUE; // 2**1024 - 2**971
const MAX_ULP = 2 ** 971;

function twoSum(x: number, y: number): [high: number, low: number] {
  const high = x + y;
  return [high, y - (high - x)];
}

function sumPrecise(items: Iterable<number>): number {
  const partials: number[] = [];
  // The partials stand for their sum plus `overflow` times 2**1024, so a run
  // that passes the largest double on the way to a finite answer still gets it.
  let overflow = 0;
  let positiveInfinity = false;
  let negativeInfinity = false;
  let sawNaN = false;
  let allNegativeZero = true;

  for (const item of items) {
    if (typeof item !== 'number') throw new TypeError('Math.sumPrecise: every item must be a number');
    if (!Object.is(item, -0)) allNegativeZero = false;
    if (Number.isNaN(item)) {
      sawNaN = true;
      continue;
    }
    if (item === Infinity) {
      positiveInfinity = true;
      continue;
    }
    if (item === -Infinity) {
      negativeInfinity = true;
      continue;
    }

    let x = item;
    let kept = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      let [high, low] = twoSum(x, y);
      if (!Number.isFinite(high)) {
        const sign = high > 0 ? 1 : -1;
        overflow += sign;
        x = x - sign * 2 ** 1023 - sign * 2 ** 1023;
        if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
        [high, low] = twoSum(x, y);
      }
      if (low !== 0) partials[kept++] = low;
      x = high;
    }
    partials.length = kept;
    if (x !== 0) partials.push(x);
  }

  if (sawNaN || (positiveInfinity && negativeInfinity)) return NaN;
  if (positiveInfinity) return Infinity;
  if (negativeInfinity) return -Infinity;
  // The empty sum is -0, as the specification has it; so is a sum of -0s.
  if (allNegativeZero) return -0;

  let index = partials.length - 1;
  let high = 0;
  let low = 0;

  if (overflow !== 0) {
    const next = index >= 0 ? partials[index]! : 0;
    index--;
    if (Math.abs(overflow) > 1 || (overflow > 0 && next > 0) || (overflow < 0 && next < 0)) {
      return overflow > 0 ? Infinity : -Infinity;
    }
    // Halved, so the arithmetic itself cannot overflow.
    [high, low] = twoSum(overflow * 2 ** 1023, next / 2);
    low *= 2;
    if (!Number.isFinite(2 * high)) {
      // Rounds to infinity unless the rest of the partials pull it back down
      // to the largest double, which is the one finite case left.
      if (high > 0) {
        return high === 2 ** 1023 && low === -(MAX_ULP / 2) && index >= 0 && partials[index]! < 0
          ? MAX_DOUBLE
          : Infinity;
      }
      return high === -(2 ** 1023) && low === MAX_ULP / 2 && index >= 0 && partials[index]! > 0
        ? -MAX_DOUBLE
        : -Infinity;
    }
    if (low !== 0) {
      partials[++index] = low;
      low = 0;
    }
    high *= 2;
  }

  // Add the partials from the largest down until one is lost to rounding.
  while (index >= 0) {
    const x = high;
    const y = partials[index--]!;
    [high, low] = twoSum(x, y);
    if (low !== 0) break;
  }

  // Exactly half an ulp left over: the next partial decides which way it rounds.
  if (index >= 0 && ((low < 0 && partials[index]! < 0) || (low > 0 && partials[index]! > 0))) {
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
