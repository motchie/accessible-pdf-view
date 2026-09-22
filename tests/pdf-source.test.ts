import { beforeEach, describe, expect, it, vi } from 'vitest';

const takeHandoff = vi.hoisted(() => vi.fn<(id: string) => Promise<ArrayBuffer | null>>());
vi.mock('../lib/browser/handoff', () => ({ takeHandoff }));

import { HandoffPdfSource } from '../lib/pdf/source/handoff-pdf-source';

/**
 * The bytes reach the Reader once, and the source remembers them — a handoff is
 * consumed by being read, and React's StrictMode asks twice in development.
 * What it must not remember is a failure: the Reader's retry button is what
 * somebody presses after granting access to the site that refused, and a
 * remembered rejection would replay the old error without trying again.
 */
describe('a handoff that is read twice', () => {
  beforeEach(() => {
    takeHandoff.mockReset();
  });

  it('is taken once, however often the bytes are asked for', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    takeHandoff.mockResolvedValue(bytes);
    const source = new HandoffPdfSource('abc', null);

    await expect(source.getBytes()).resolves.toBe(bytes);
    await expect(source.getBytes()).resolves.toBe(bytes);
    expect(takeHandoff).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failure, which is what makes retrying work', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    // Nothing parked, and no URL to fall back to: the first attempt fails.
    takeHandoff.mockResolvedValueOnce(null).mockResolvedValueOnce(bytes);
    const source = new HandoffPdfSource('abc', null);

    await expect(source.getBytes()).rejects.toThrow();
    await expect(source.getBytes()).resolves.toBe(bytes);
    expect(takeHandoff).toHaveBeenCalledTimes(2);
  });
});
