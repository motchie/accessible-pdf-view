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
 *
 * And the same inside template strings, in any module but the catalogue
 * itself: `${…} ${…}` with a message on either side, or a message written
 * after a leading space. Two of the joins hid there, after the JSX ones had
 * been fixed and this test said there were none. *
 * It recognises message text by the catalogue's name, `m` — `const m =
 * useMessages()` in every component, and the `m` that helpers take. That is
 * the convention this test depends on: a component that names it otherwise,
 * or destructures it (`const { notices } = m`), joins sentences this test
 * cannot see. Keep the name, or teach the patterns below the new one.
 */
const root = resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(path) ? [path] : [];
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

/** The same, inside template strings. */
export function templateJoins(text: string): string[] {
  const found: string[] = [];
  const message = /\bm[.,)]/;
  // `${a} ${b}`, either reading from the catalogue.
  for (const match of text.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\} +\$\{([^{}]*)/g)) {
    if (message.test(match[1]!) || message.test(match[2]!)) found.push(match[0].slice(0, 80));
  }
  // `` ` ${m.…}` ``: a message appended to something with a leading space.
  for (const match of text.matchAll(/`[ \t]+\$\{([^{}]*)/g)) {
    if (message.test(match[1]!)) found.push(match[0].slice(0, 80));
  }
  return found;
}

describe('message joins in JSX', () => {
  it('finds the shapes this was written for', () => {
    // As they were before #46.
    expect(literalJoins("{m.settings.modelUnavailable} {m.settings.modelUnavailableReason[r]}")).toHaveLength(1);
    expect(literalJoins('{scope} {m.notices.ocrRequired.mayHelp}')).toHaveLength(1);
    expect(literalJoins("{reading ? m.markdown.a(reading) : m.markdown.b}{' '}\n            {m.markdown.c}")).toHaveLength(1);
    expect(templateJoins('return `${m.describePanel.languageIs(x)} ${languageSource(m, choice)}`;')).toHaveLength(1);
    expect(templateJoins('{viewingOriginal ? null : ` ${m.notices.ocrRequired.originalHint}`}')).toHaveLength(1);
    // A separator that is not a bare space is the message's own design.
    expect(templateJoins('`${name} — ${m.app.name}`')).toHaveLength(0);
    // And leaves layout alone.
    expect(literalJoins("</button>{' '}\n<span>{m.ocrPanel.note}</span>")).toHaveLength(0);
    expect(literalJoins('{m.joinSentences(a, b)}')).toHaveLength(0);
  });

  it('happens nowhere in the components', () => {
    const catalogue = resolve(root, 'lib/i18n');
    const offenders = [...sources(resolve(root, 'lib')), ...sources(resolve(root, 'entrypoints'))]
      .filter((file) => !file.startsWith(catalogue))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8');
        return [...literalJoins(text), ...templateJoins(text)].map((join) => `${relative(root, file)}: ${join}`);
      });
    expect(offenders).toEqual([]);
  });
});
