// @vitest-environment node
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THIRD_PARTY_NOTICES.md against what is actually installed.
 *
 * The notices are a claim about what the extension redistributes, and they
 * drifted silently: PDF.js was listed as 6.2.108 while 6.3.289 shipped, React
 * and mdast a minor behind, and the packages pulled in with them not at all.
 * Every update is a chance to forget the file, so this is what remembers it.
 */

const root = resolve(import.meta.dirname, '..');

interface LockEntry {
  version: string;
  link?: boolean;
  resolved?: string;
  license?: string;
  dependencies?: Record<string, string>;
}

async function load() {
  const notices = await readFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, LockEntry & { dependencies?: Record<string, string> }>;
  };
  const installed = (name: string): LockEntry => {
    const entry = lock.packages[`node_modules/${name}`];
    if (!entry) throw new Error(`${name} is not installed at the top level`);
    // A `file:` dependency (the vendored pdf-inspector build) is a link to
    // the directory that carries its version.
    return entry.link ? lock.packages[entry.resolved!]! : entry;
  };
  return { notices, lock, installed };
}

/** The table rows under a heading, as arrays of cells. */
function tableUnder(markdown: string, heading: string): string[][] {
  const start = markdown.indexOf(`${heading}\n`);
  if (start === -1) throw new Error(`no "${heading}" section`);
  const rows: string[][] = [];
  let inTable = false;
  for (const line of markdown.slice(start).split('\n').slice(1)) {
    if (line.startsWith('|')) {
      inTable = true;
      rows.push(line.split('|').slice(1, -1).map((cell) => cell.trim()));
    } else if (inTable) {
      break;
    } else if (line.startsWith('#')) {
      break;
    }
  }
  // Header and separator.
  return rows.slice(2);
}

/** `1.2.3` matches a listed `1.2` or `1.2.3`, not `1.20`. */
function matchesListed(version: string, listed: string): boolean {
  return version === listed || version.startsWith(`${listed}.`) || version.startsWith(`${listed}-`);
}

describe('THIRD_PARTY_NOTICES.md', () => {
  it('lists every production dependency at the version installed', async () => {
    const { notices, lock, installed } = await load();
    const rows = tableUnder(notices, '## Shipped inside the extension');

    for (const name of Object.keys(lock.packages['']!.dependencies ?? {})) {
      const row = rows.find((cells) => cells[0]!.includes(`\`${name}\``));
      expect(row, `${name} has no row`).toBeDefined();
      // "1.25.0, **modified**" lists 1.25.0.
      const listed = row![1]!.split(',')[0]!.trim();
      expect(matchesListed(installed(name).version, listed), `${name}: listed ${listed}, installed ${installed(name).version}`).toBe(true);
    }
  });

  it('lists what those dependencies bring with them, as the lockfile has it', async () => {
    const { notices, lock, installed } = await load();
    const direct = new Set(Object.keys(lock.packages['']!.dependencies ?? {}));

    // What the notices describe: production dependencies only (optional ones,
    // such as PDF.js's Node canvas, are never bundled), without type
    // declarations, which carry no code.
    const reached = new Map<string, LockEntry>();
    const visit = (name: string) => {
      if (reached.has(name) || name.startsWith('@types/')) return;
      const entry = installed(name);
      reached.set(name, entry);
      for (const dependency of Object.keys(entry.dependencies ?? {})) visit(dependency);
    };
    for (const name of direct) visit(name);

    const expected = [...reached]
      .filter(([name]) => !direct.has(name))
      .map(([name, entry]) => [`\`${name}\``, entry.version.split('.').slice(0, 2).join('.'), entry.license ?? ''])
      .sort(([a], [b]) => (a!.replace(/`/g, '') < b!.replace(/`/g, '') ? -1 : 1));

    expect(tableUnder(notices, '### Bundled with the above')).toEqual(expected);
  });

  it('does not ship PDF.js files it does not list', () => {
    // QuickJS runs a PDF's own JavaScript in PDF.js's sandbox, which this
    // extension does not ship; copy-assets leaves it out.
    const wasm = resolve(root, 'public/pdfjs/wasm');
    expect(existsSync(wasm), 'run copy-assets (npm install does)').toBe(true);
    expect(readdirSync(wasm).filter((name) => name.startsWith('quickjs'))).toEqual([]);
  });
});
