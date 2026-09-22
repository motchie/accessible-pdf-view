/**
 * How far the model download has got, in the steps it is announced in.
 *
 * The number itself is continuous and the progress event fires constantly. Put
 * straight into a live region it produced a hundred distinct sentences — "12%",
 * "13%", "14%" — each one queued behind the last by a screen reader, for a
 * download measured in gigabytes. That is not progress reporting; it is a
 * filibuster over whatever else the page had to say.
 *
 * Ten steps instead. Enough to tell a download that is moving from one that has
 * stalled, which is the only question this number answers, and few enough that
 * hearing all of them is not a punishment.
 *
 * Rounded **down**: at 37% the download has certainly passed 30%, and "30%" is
 * therefore true where "40%" would not be. `null` below the first step, so the
 * caller says "preparing" rather than opening with "0%", which reads like
 * something that has not started.
 */
export function downloadPercent(loaded: number): number | null {
  if (!Number.isFinite(loaded) || loaded <= 0) return null;
  const step = Math.floor(loaded * 10) * 10;
  // A `loaded` of 1 lands on 100; anything above it is a browser reporting
  // something this cannot interpret, and claiming more than finished is worse
  // than claiming finished.
  return step < 10 ? null : Math.min(step, 100);
}
