import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyKnownGaps,
  diffOutlines,
  OutlineParseError,
  parseOutline,
  serializeOutline,
  type KnownGap,
} from './helpers/outline';

/**
 * The outline format the accessibility fixtures are written in.
 *
 * An expected outline is compared as canonical text, so these hold the parser
 * and serialiser to each other: whatever a person can write must come back out
 * in one fixed form, or two outlines that say the same thing would differ.
 */
const CANONICAL = `document lang=ja title="アクセシビリティ検証用文書 その1"
  heading level=1 "アクセシビリティ検証用文書 その1"
  paragraph "詳しくは、Accessible PDF View のサイトをご覧ください。"
    link href=https://accessiblepdfview.org "Accessible PDF View のサイト"
  list ordered
    listitem "PDF を開く"
  table
    row
      columnheader "要素"
      cell "見出し"
  figure
    img "月ごとの閲覧数の棒グラフ。"
`;

describe('parseOutline', () => {
  it('reads roles, attributes, names and nesting', () => {
    const [root] = parseOutline(CANONICAL);
    expect(root).toMatchObject({
      role: 'document',
      attributes: { lang: 'ja', title: 'アクセシビリティ検証用文書 その1' },
    });
    expect(root!.name).toBeUndefined();
    expect(root!.children.map((child) => child.role)).toEqual([
      'heading',
      'paragraph',
      'list',
      'table',
      'figure',
    ]);
    expect(root!.children[0]).toMatchObject({ attributes: { level: '1' } });
    expect(root!.children[1]!.children[0]).toMatchObject({
      role: 'link',
      attributes: { href: 'https://accessiblepdfview.org' },
      name: 'Accessible PDF View のサイト',
    });
    expect(root!.children[2]).toMatchObject({ attributes: { ordered: true } });
  });

  it('skips comments and blank lines', () => {
    const nodes = parseOutline('# a comment\n\nheading level=2 "A"\n  # indented comment\nparagraph "B"\n');
    expect(nodes.map((node) => node.role)).toEqual(['heading', 'paragraph']);
  });

  it('resolves escapes inside quotes', () => {
    const [node] = parseOutline('paragraph title="say \\"hi\\"" "back\\\\slash and \\"quote\\""');
    expect(node!.attributes.title).toBe('say "hi"');
    expect(node!.name).toBe('back\\slash and "quote"');
  });

  it('keeps an ideographic space as text', () => {
    const [node] = parseOutline('paragraph "見出し　本文"');
    expect(node!.name).toBe('見出し　本文');
  });

  it('normalises names to NFC', () => {
    // "が" written as か + combining voiced mark.
    const [node] = parseOutline('heading "が"');
    expect(node!.name).toBe('が');
  });

  it.each([
    ['odd indentation', 'list\n   listitem "A"', 2],
    ['a skipped level', 'list\n    listitem "A"', 2],
    ['tabs', 'list\n\tlistitem "A"', 2],
    ['two names', 'paragraph "A" "B"', 1],
    ['an attribute after the name', 'paragraph "A" lang=ja', 1],
    ['an unterminated quote', 'paragraph "A', 1],
    ['a line starting with a name', '"A"', 1],
    ['a repeated attribute', 'heading level=1 level=2', 1],
    ['an unknown escape', 'paragraph "a\\nb"', 1],
  ])('rejects %s with its line number', (_label, text, line) => {
    expect(() => parseOutline(text)).toThrow(OutlineParseError);
    try {
      parseOutline(text);
    } catch (error) {
      expect((error as OutlineParseError).line).toBe(line);
    }
  });
});

describe('serializeOutline', () => {
  it('round-trips canonical text', () => {
    expect(serializeOutline(parseOutline(CANONICAL))).toBe(CANONICAL);
  });

  it('writes attributes in a fixed order and quotes only where needed', () => {
    const text = serializeOutline(
      parseOutline('link title="a b" zeta=1 href=https://example.org/x lang="en" "Example"'),
    );
    expect(text).toBe('link lang=en href=https://example.org/x title="a b" zeta=1 "Example"\n');
  });

  it('quotes an empty value and one containing "=" or "#"', () => {
    const text = serializeOutline({
      role: 'link',
      attributes: { href: 'https://example.org/?a=1#top', title: '' },
      children: [],
    });
    expect(text).toBe('link href="https://example.org/?a=1#top" title=""\n');
    expect(serializeOutline(parseOutline(text))).toBe(text);
  });

  it('writes nothing for an empty outline', () => {
    expect(serializeOutline([])).toBe('');
  });
});

describe('diffOutlines', () => {
  it('is null for outlines that differ only in comments, spacing and attribute order', () => {
    const written = `# expected
document title="T" lang=ja

  heading level=2 "A"
`;
    expect(diffOutlines(written, 'document lang=ja title=T\n  heading level=2 "A"\n')).toBeNull();
  });

  it('reports a change as a numbered unified diff', () => {
    const expected = ['document', '  heading level=2 "A"', '  paragraph "one"', '  paragraph "two"'].join('\n');
    const actual = ['document', '  heading level=3 "A"', '  paragraph "one"', '  paragraph "two"'].join('\n');

    expect(diffOutlines(expected, actual)).toBe(
      [
        '--- expected',
        '+++ actual',
        '@@ -1,4 +1,4 @@',
        '  1 document',
        '- 2   heading level=2 "A"',
        '+ 2   heading level=3 "A"',
        '  3   paragraph "one"',
        '  4   paragraph "two"',
      ].join('\n'),
    );
  });

  it('numbers additions by the actual side and deletions by the expected side', () => {
    const expected = 'document\n  paragraph "a"\n  paragraph "c"\n';
    const actual = 'document\n  paragraph "a"\n  paragraph "b"\n  paragraph "c"\n';
    expect(diffOutlines(expected, actual)).toContain('+ 3   paragraph "b"');
    expect(diffOutlines(actual, expected)).toContain('- 3   paragraph "b"');
  });

  it('splits distant changes into separate hunks', () => {
    const lines = Array.from({ length: 20 }, (_, index) => `  paragraph "${index}"`);
    const expected = ['document', ...lines].join('\n');
    const changed = [...lines];
    changed[1] = '  paragraph "first"';
    changed[18] = '  paragraph "last"';
    const diff = diffOutlines(expected, ['document', ...changed].join('\n'))!;
    expect(diff.match(/^@@/gm)).toHaveLength(2);
  });

  it('accepts parsed trees as well as text', () => {
    const tree = parseOutline('document\n  heading level=2 "A"\n');
    expect(diffOutlines(tree, 'document\n  heading level=2 "A"\n')).toBeNull();
  });
});

describe('applyKnownGaps', () => {
  const expected = `
article
  list
    listitem
      paragraph "a"
      list
        listitem
          paragraph "b"
`;
  const flattened = `
article
  list
    listitem
      paragraph "a"
    listitem
      paragraph "b"
`;
  const gap: KnownGap = {
    cause: 'producer',
    reason: 'flattened',
    ideal: `
listitem
  paragraph "a"
  list
    listitem
      paragraph "b"
`,
    actual: `
listitem
  paragraph "a"
listitem
  paragraph "b"
`,
  };

  it('replaces the ideal with what is exposed instead, at its indentation', () => {
    const result = applyKnownGaps(expected, flattened, [gap]);
    expect(result.problems).toEqual([]);
    expect(diffOutlines(result.expected, flattened)).toBeNull();
  });

  it('reports a gap that has been closed', () => {
    const result = applyKnownGaps(expected, expected, [gap]);
    expect(result.problems).toEqual(['known gap "flattened": the ideal is now exposed; remove the gap']);
  });

  it('reports a gap whose ideal is not in the expected outline', () => {
    const result = applyKnownGaps(flattened, flattened, [gap]);
    expect(result.problems).toEqual([
      'known gap "flattened": its ideal appears 0 times in the expected outline, not once',
    ]);
  });

  it('does not match part of a node', () => {
    const partial: KnownGap = { ...gap, ideal: 'listitem\n  paragraph "a"\n' };
    const result = applyKnownGaps(expected, flattened, [partial]);
    expect(result.problems).toHaveLength(1);
  });
});

describe('the committed expected outlines', () => {
  // Parsed even while their PDFs are absent, so a malformed expectation is
  // caught when it is written rather than when the PDF arrives.
  it.each(['word-basic', 'word-small-figures'])('%s.outline parses and is canonical apart from comments', async (name) => {
    const text = await readFile(resolve(import.meta.dirname, `fixtures/word/${name}.outline`), 'utf8');
    const nodes = parseOutline(text);
    expect(nodes).toHaveLength(1);
    // Compared as written, not through `diffOutlines`, which canonicalises
    // both sides and so could never fail here.
    const written = text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
      .map((line) => `${line}\n`)
      .join('');
    expect(written).toBe(serializeOutline(nodes));
  });
});
