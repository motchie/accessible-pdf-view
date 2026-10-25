import type { KnownGap } from '../../helpers/outline';

/**
 * Where each Word fixture's reading is known to fall short of its outline.
 *
 * The outlines keep the ideal; these say what is exposed instead and why. A gap
 * that closes fails the test until it is removed here.
 */
export const KNOWN_GAPS: Record<string, KnownGap[]> = {
  'word-basic': [
    {
      cause: 'producer',
      reason:
        'Word 2609 (16.0.20430.20032) tags the List Bullet 2 item as a fourth LI of the same L, ' +
        'so the PDF carries no nesting',
      ideal: `
listitem
  paragraph "箇条書きと番号付きリスト"
  list
    listitem
      paragraph "入れ子の箇条書き"
`,
      actual: `
listitem
  paragraph "箇条書きと番号付きリスト"
listitem
  paragraph "入れ子の箇条書き"
`,
    },
  ],
};
