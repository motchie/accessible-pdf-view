import { describe, expect, it } from 'vitest';
import { groupTextLines } from '../lib/pdf/pdfjs/page-lines';

/** A PDF.js text item at a position; height defaults to 11pt body text. */
function run(str: string, x: number, y: number, width: number, height = 11.04) {
  return { str, width, height, transform: [height, 0, 0, height, x, y] };
}

describe('rebuilding lines from text runs', () => {
  it('joins runs on one baseline and splits at the next', () => {
    const lines = groupTextLines([
      run('１', 56.6, 488.2, 11),
      run('.', 67.7, 488.2, 5.5),
      run(' ', 73.2, 488.2, 5.7),
      run('見出し', 78.9, 488.2, 73.7),
      { str: '', width: 0, height: 0, transform: [0, 0, 0, 0, 67.7, 469.1], hasEOL: true },
      run('SAMPLE', 67.7, 469.1, 44.4),
    ]);

    expect(lines.map((line) => line.text)).toEqual(['１. 見出し', 'SAMPLE']);
    expect(lines[0]).toMatchObject({ left: 56.6, baseline: 488.2, height: 11.04 });
    expect(lines[0]!.right).toBeCloseTo(152.6, 1);
    expect(lines[1]!.left).toBe(67.7);
  });



  it('ignores marked-content markers and runs without a position', () => {
    const lines = groupTextLines([
      { type: 'beginMarkedContent', id: 'p1R_mc0' },
      run('本文', 56.6, 700, 22),
      { str: 'なし' },
      { type: 'endMarkedContent' },
    ]);
    expect(lines.map((line) => line.text)).toEqual(['本文']);
  });
});
