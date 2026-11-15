import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Messages written next to each other are joined by the catalogue
 * (`joinSentences`, or a message that takes the parts), never by a literal
 * space in JSX: the space, or its absence, is the language's. Four places had
 * it decided in JSX, each right for one language only (#46). This scans the
 * components for that shape, so a fifth does not need a reviewer to find it.
 *
 * What counts: a space — `{' '}` or plain whitespace between two expressions —
 * with message text on either side of it, i.e. an expression that reads from
 * the catalogue (`m.…`). A space between an element and something else, such
 * as a button and the note beside it, is layout and is left alone.
 */
const root = resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/** Each place in `text` where message text is joined by a literal space. */
export function literalJoins(text: string): string[] {
  const found: string[] = [];
  // A `{…}` expression, then `{' '}` or a run of spaces or a line break,
  // then another `{…}` expression; either reading from the catalogue.
  const pattern = /\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}(\{' '\}\s*|[ \t]+|[ \t]*\n\s*)\{([^{}]*)/g;
  for (const match of text.matchAll(pattern)) {
    const [, before, joiner, after] = match;
    const literalSpace = joiner!.includes("{' '}") || /^[ \t]+$/.test(joiner!);
    if (!literalSpace) continue;
    if (/\bm\./.test(before!) || /^\s*m\./.test(after!)) found.push(match[0].slice(0, 80));
  }
  return found;
}

describe('message joins in JSX', () => {
  it('finds the shapes this was written for', () => {
    // As they were before #46.
    expect(literalJoins("{m.settings.modelUnavailable} {m.settings.modelUnavailableReason[r]}")).toHaveLength(1);
    expect(literalJoins('{scope} {m.notices.ocrRequired.mayHelp}')).toHaveLength(1);
    expect(literalJoins("{reading ? m.markdown.a(reading) : m.markdown.b}{' '}\n            {m.markdown.c}")).toHaveLength(1);
    // And leaves layout alone.
    expect(literalJoins("</button>{' '}\n<span>{m.ocrPanel.note}</span>")).toHaveLength(0);
    expect(literalJoins('{m.joinSentences(a, b)}')).toHaveLength(0);
  });

  it('happens nowhere in the components', () => {
    const offenders = [...sources(resolve(root, 'lib')), ...sources(resolve(root, 'entrypoints'))]
      .flatMap((file) => literalJoins(readFileSync(file, 'utf8')).map((join) => `${relative(root, file)}: ${join}`));
    expect(offenders).toEqual([]);
  });
});
