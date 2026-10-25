/**
 * The accessibility outline: a hand-writable text form of what a rendered
 * document exposes to assistive technology.
 *
 * A fixture's expected outline is written by a person from what the document
 * *means* — its headings, lists, tables and pictures as the author intended
 * them — and compared against what the Reader actually renders. It is text
 * rather than a snapshot of HTML because the thing under test is the
 * accessibility tree, not the markup: `<th scope="col">` and a `columnheader`
 * are the same claim, and a reviewer can read the second one against the
 * source document without knowing how the first is spelled.
 *
 * ## Format
 *
 * One node per line; two spaces of indentation per level of nesting.
 *
 *     document lang=ja title="Report"
 *       heading level=2 "Introduction"
 *       list ordered
 *         listitem
 *           paragraph "Open the PDF"
 *
 * A line is a role, then any number of attributes, then at most one quoted
 * string, which is the node's name (its text). An attribute is `key=value`, or
 * a bare `key` for a flag. A value is quoted when it has to be — when it is
 * empty or contains whitespace, `"`, `=`, `#` or `\`. Inside quotes, `\"` and
 * `\\` escape themselves. A line whose first non-space character is `#` is a
 * comment; blank lines are ignored.
 *
 * Names are compared after Unicode NFC normalisation, so an expected file typed
 * on one system matches text extracted on another.
 */

export interface OutlineNode {
  role: string;
  /** `true` for a bare flag such as `ordered`. */
  attributes: Record<string, string | true>;
  name?: string;
  children: OutlineNode[];
}

export class OutlineParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`line ${line}: ${message}`);
    this.name = 'OutlineParseError';
  }
}

/**
 * The order attributes are written in. Fixed so that serialising is canonical:
 * two outlines that say the same thing are the same text, and a diff shows only
 * what differs. Attributes not listed follow, alphabetically.
 */
const ATTRIBUTE_ORDER = ['level', 'ordered', 'lang', 'href', 'title'];

export function parseOutline(text: string): OutlineNode[] {
  const roots: OutlineNode[] = [];
  // The open node at each depth; `stack[depth]` is the parent of a node one
  // level deeper.
  const stack: OutlineNode[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1;
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) return;

    if (/^\s*\t/.test(raw)) throw new OutlineParseError('indent with spaces, not tabs', lineNumber);
    const indent = raw.length - raw.trimStart().length;
    if (indent % 2 !== 0) {
      throw new OutlineParseError(`indentation of ${indent} is not a multiple of two`, lineNumber);
    }
    const depth = indent / 2;
    if (depth > stack.length) {
      throw new OutlineParseError('indented more than one level below the line above', lineNumber);
    }

    const node = parseLine(raw.trim(), lineNumber);
    stack.length = depth;
    if (depth === 0) roots.push(node);
    else stack[depth - 1]!.children.push(node);
    stack.push(node);
  });

  return roots;
}

function parseLine(line: string, lineNumber: number): OutlineNode {
  const tokens = tokenize(line, lineNumber);
  const first = tokens.shift();
  if (!first || first.quoted || first.text.includes('=')) {
    throw new OutlineParseError('a line must start with a role', lineNumber);
  }

  const node: OutlineNode = { role: first.text, attributes: {}, children: [] };
  for (const token of tokens) {
    if (token.quoted) {
      if (node.name !== undefined) {
        throw new OutlineParseError('a node has at most one quoted name', lineNumber);
      }
      node.name = token.text.normalize('NFC');
      continue;
    }
    if (node.name !== undefined) {
      throw new OutlineParseError('attributes come before the name', lineNumber);
    }
    const equals = token.text.indexOf('=');
    const key = equals === -1 ? token.text : token.text.slice(0, equals);
    if (!/^[a-z][a-z0-9-]*$/.test(key)) {
      throw new OutlineParseError(`"${key}" is not an attribute name`, lineNumber);
    }
    if (key in node.attributes) {
      throw new OutlineParseError(`attribute "${key}" given twice`, lineNumber);
    }
    node.attributes[key] =
      equals === -1 ? true : (token.value ?? token.text.slice(equals + 1)).normalize('NFC');
  }
  return node;
}

interface Token {
  /** The whole token as written, unquoted — `key=value` or a name. */
  text: string;
  /** True for a bare quoted string, which is a name. */
  quoted: boolean;
  /** For `key="quoted value"`, the value with its escapes resolved. */
  value?: string;
}

function tokenize(line: string, lineNumber: number): Token[] {
  const tokens: Token[] = [];
  let position = 0;

  while (position < line.length) {
    if (line[position] === ' ') {
      position++;
      continue;
    }

    if (line[position] === '"') {
      const [value, end] = readQuoted(line, position, lineNumber);
      tokens.push({ text: value, quoted: true });
      position = end;
      continue;
    }

    let end = position;
    while (end < line.length && line[end] !== ' ' && line[end] !== '"') end++;
    const bare = line.slice(position, end);

    // `key="quoted value"`: the quote follows the `=` directly.
    if (bare.endsWith('=') && line[end] === '"') {
      const [value, after] = readQuoted(line, end, lineNumber);
      tokens.push({ text: bare + value, quoted: false, value });
      position = after;
      continue;
    }
    if (line[end] === '"') {
      throw new OutlineParseError('a quote must start a name or follow "="', lineNumber);
    }
    tokens.push({ text: bare, quoted: false });
    position = end;
  }

  return tokens;
}

/** Reads a quoted string starting at `start`; returns it and the index after it. */
function readQuoted(line: string, start: number, lineNumber: number): [string, number] {
  let value = '';
  let position = start + 1;
  while (position < line.length) {
    const char = line[position]!;
    if (char === '\\') {
      const next = line[position + 1];
      if (next !== '"' && next !== '\\') {
        throw new OutlineParseError('only \\" and \\\\ are escapes', lineNumber);
      }
      value += next;
      position += 2;
      continue;
    }
    if (char === '"') {
      const after = position + 1;
      if (after < line.length && line[after] !== ' ') {
        throw new OutlineParseError('a closing quote must be followed by a space', lineNumber);
      }
      return [value, after];
    }
    value += char;
    position++;
  }
  throw new OutlineParseError('unterminated quote', lineNumber);
}

/** Canonical text: one node per line, attributes in `ATTRIBUTE_ORDER`, a final newline. */
export function serializeOutline(nodes: OutlineNode | readonly OutlineNode[]): string {
  const lines: string[] = [];
  const visit = (node: OutlineNode, depth: number) => {
    lines.push('  '.repeat(depth) + serializeNode(node));
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const node of Array.isArray(nodes) ? nodes : [nodes as OutlineNode]) visit(node, 0);
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function serializeNode(node: OutlineNode): string {
  const keys = Object.keys(node.attributes).sort((a, b) => {
    const rankA = ATTRIBUTE_ORDER.indexOf(a);
    const rankB = ATTRIBUTE_ORDER.indexOf(b);
    if (rankA !== rankB) {
      if (rankA === -1) return 1;
      if (rankB === -1) return -1;
      return rankA - rankB;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const parts = [node.role];
  for (const key of keys) {
    const value = node.attributes[key]!;
    parts.push(value === true ? key : `${key}=${quoteIfNeeded(value)}`);
  }
  if (node.name !== undefined) parts.push(quote(node.name));
  return parts.join(' ');
}

function quoteIfNeeded(value: string): string {
  return value === '' || /[\s"=#\\]/.test(value) ? quote(value) : value;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * A readable difference between two outlines, or null when they are the same.
 *
 * Both sides are canonicalised first, so comments, blank lines, attribute order
 * and quoting style in a hand-written file never count as differences. The
 * result is a unified diff of the canonical text with three lines of context,
 * each line carrying its line number in the canonical text — expected numbers
 * for `-` and context lines, actual numbers for `+`.
 */
export function diffOutlines(
  expected: string | OutlineNode | readonly OutlineNode[],
  actual: string | OutlineNode | readonly OutlineNode[],
): string | null {
  const a = canonicalLines(expected);
  const b = canonicalLines(actual);
  if (a.length === b.length && a.every((line, index) => line === b[index])) return null;

  const ops = lineDiff(a, b);
  return formatUnified(ops, a.length, b.length);
}

/**
 * A place where what the Reader exposes is known to fall short of the ideal,
 * and why.
 *
 * The expected outline keeps saying what the document means; a gap records the
 * departure next to it instead of quietly rewriting the ideal. The cause is
 * part of the record because the two kinds are acted on differently: a
 * `producer` gap is in the PDF itself — the tags do not carry what the author
 * meant — while a `reader` gap is the Reader's to fix.
 */
export interface KnownGap {
  cause: 'producer' | 'reader';
  /** What is wrong and where it was established, in a sentence or two. */
  reason: string;
  /** The ideal, as it appears in the expected outline: a run of whole nodes at
   * any depth, written without the surrounding indentation. */
  ideal: string;
  /** What is exposed instead, written the same way. */
  actual: string;
}

/**
 * The expected outline with each known gap's ideal replaced by what is exposed
 * instead, plus anything wrong with the gaps themselves.
 *
 * Two problems are reported rather than tolerated. A gap whose ideal is not in
 * the expected outline exactly once has drifted from the file it annotates. A
 * gap whose ideal now appears in the actual outline has been closed — by the
 * producer or by the Reader — and must be removed, or it would go on describing
 * a shortfall that no longer exists.
 */
export function applyKnownGaps(
  expected: string | OutlineNode | readonly OutlineNode[],
  actual: string | OutlineNode | readonly OutlineNode[],
  gaps: readonly KnownGap[],
): { expected: string; problems: string[] } {
  let lines = canonicalLines(expected);
  const actualLines = canonicalLines(actual);
  const problems: string[] = [];

  for (const gap of gaps) {
    const ideal = canonicalLines(gap.ideal);
    const replacement = canonicalLines(gap.actual);
    const found = findBlock(lines, ideal);
    if (found.length !== 1) {
      problems.push(
        `known gap "${gap.reason}": its ideal appears ${found.length} times in the expected outline, not once`,
      );
      continue;
    }
    if (findBlock(actualLines, ideal).length > 0) {
      problems.push(`known gap "${gap.reason}": the ideal is now exposed; remove the gap`);
      continue;
    }
    const { index, indent } = found[0]!;
    lines = [
      ...lines.slice(0, index),
      ...replacement.map((line) => indent + line),
      ...lines.slice(index + ideal.length),
    ];
  }

  return { expected: lines.length === 0 ? '' : `${lines.join('\n')}\n`, problems };
}

/** Where `block` (unindented) occurs in `lines` at a uniform indentation. */
function findBlock(lines: readonly string[], block: readonly string[]): { index: number; indent: string }[] {
  if (block.length === 0) return [];
  const found: { index: number; indent: string }[] = [];
  for (let index = 0; index + block.length <= lines.length; index++) {
    const first = lines[index]!;
    if (!first.endsWith(block[0]!)) continue;
    const indent = first.slice(0, first.length - block[0]!.length);
    if (!/^ *$/.test(indent)) continue;
    if (!block.every((line, offset) => lines[index + offset] === indent + line)) continue;
    // Whole nodes only: a line right after the block that is deeper than the
    // block's roots is a child the block left out.
    const next = lines[index + block.length];
    if (next !== undefined && next.length - next.trimStart().length > indent.length) continue;
    found.push({ index, indent });
  }
  return found;
}

function canonicalLines(outline: string | OutlineNode | readonly OutlineNode[]): string[] {
  const text = serializeOutline(typeof outline === 'string' ? parseOutline(outline) : outline);
  return text === '' ? [] : text.slice(0, -1).split('\n');
}

type Op =
  | { kind: ' '; text: string; a: number; b: number }
  | { kind: '-'; text: string; a: number; b: number }
  | { kind: '+'; text: string; a: number; b: number };

/**
 * Longest-common-subsequence diff. Outlines are hundreds of lines at most, so
 * the quadratic table is fine and keeps this dependency-free.
 */
function lineDiff(a: string[], b: string[]): Op[] {
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i]!, a: i, b: j });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      ops.push({ kind: '+', text: b[j]!, a: i, b: j });
      j++;
    } else {
      ops.push({ kind: '-', text: a[i]!, a: i, b: j });
      i++;
    }
  }
  // Within a run of changes, deletions read better before insertions.
  return reorderRuns(ops);
}

function reorderRuns(ops: Op[]): Op[] {
  const out: Op[] = [];
  let run: Op[] = [];
  const flush = () => {
    out.push(...run.filter((op) => op.kind === '-'), ...run.filter((op) => op.kind === '+'));
    run = [];
  };
  for (const op of ops) {
    if (op.kind === ' ') {
      flush();
      out.push(op);
    } else {
      run.push(op);
    }
  }
  flush();
  return out;
}

const CONTEXT = 3;

function formatUnified(ops: Op[], lengthA: number, lengthB: number): string {
  const width = String(Math.max(lengthA, lengthB, 1)).length;
  const changed = ops.map((op, index) => (op.kind === ' ' ? -1 : index)).filter((index) => index >= 0);

  // Group changes whose context would touch into one hunk.
  const hunks: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT);
    const end = Math.min(ops.length - 1, index + CONTEXT);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1] + 1) last[1] = end;
    else hunks.push([start, end]);
  }

  const out = ['--- expected', '+++ actual'];
  for (const [start, end] of hunks) {
    const slice = ops.slice(start, end + 1);
    const countA = slice.filter((op) => op.kind !== '+').length;
    const countB = slice.filter((op) => op.kind !== '-').length;
    const first = slice[0]!;
    // Unified diff numbers from 1; an empty side names the line before it.
    const startA = countA === 0 ? first.a : first.a + 1;
    const startB = countB === 0 ? first.b : first.b + 1;
    out.push(`@@ -${startA},${countA} +${startB},${countB} @@`);
    for (const op of slice) {
      const number = op.kind === '+' ? op.b + 1 : op.a + 1;
      out.push(`${op.kind} ${String(number).padStart(width)} ${op.text}`);
    }
  }
  return out.join('\n');
}
