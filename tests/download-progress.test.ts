import { describe, expect, it } from 'vitest';
import { downloadPercent } from '../lib/reader/download-progress';

/**
 * The model download is the longest thing this extension does, and its progress
 * goes into a live region. Every distinct number in that region is a sentence a
 * screen reader has to say, so how many distinct numbers there are is an
 * accessibility decision rather than a formatting one.
 */
describe('how often a download announces itself', () => {
  it('moves in ten steps, whatever the browser reports', () => {
    const announced = new Set<number | null>();
    for (let i = 0; i <= 1000; i++) announced.add(downloadPercent(i / 1000));

    // Ten numbers and the silence before the first one. A hundred would be a
    // hundred announcements queued behind each other.
    expect([...announced].filter((value) => value !== null).sort((a, b) => a! - b!)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
    ]);
  });

  /** Rounded down, so the number is one the download has certainly passed. */
  it('never claims more than has happened', () => {
    expect(downloadPercent(0.37)).toBe(30);
    expect(downloadPercent(0.999)).toBe(90);
    expect(downloadPercent(1)).toBe(100);
  });

  /** "0%" reads like something that has not started. The caller says
   * "preparing" instead until there is a step to report. */
  it('says nothing at all below the first step', () => {
    expect(downloadPercent(0)).toBeNull();
    expect(downloadPercent(0.09)).toBeNull();
    expect(downloadPercent(0.1)).toBe(10);
  });

  /** A browser reporting something uninterpretable must not become a claim.
   * Over 100% is the one that would be visible. */
  it('claims nothing from a number it cannot read', () => {
    expect(downloadPercent(Number.NaN)).toBeNull();
    expect(downloadPercent(-1)).toBeNull();
    expect(downloadPercent(2)).toBe(100);
  });
});
