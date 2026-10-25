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
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

interface Installed {
  name: string;
  /** Where the lockfile has it, e.g. `node_modules/a/node_modules/b`. */
  path: string;
  entry: LockEntry;
}

/**
 * The copy of `name` that the package at `from` gets, found as Node finds it:
 * its own `node_modules` first, then each enclosing one up to the top. A
 * nested copy is a different version from the hoisted one, and it is the
 * nested copy that is bundled for that package.
 */
function resolveInstalled(packages: Record<string, LockEntry>, name: string, from = ''): Installed {
  let base = from;
  for (;;) {
    const path = `${base ? `${base}/` : ''}node_modules/${name}`;
    const entry = packages[path];
    if (entry) {
      // A `file:` dependency (the vendored pdf-inspector build) is a link to
      // the directory that carries its version.
      return { name, path, entry: entry.link ? packages[entry.resolved!]! : entry };
    }
    if (!base) throw new Error(`${name} (needed by ${from || 'the package'}) is not in the lockfile`);
    const parent = base.lastIndexOf('/node_modules/');
    base = parent === -1 ? '' : base.slice(0, parent);
  }
}

/** Everything bundled for `direct`: dependencies and required peers, by lock path. */
function bundledClosure(packages: Record<string, LockEntry>, direct: Iterable<string>): Map<string, Installed> {
  const reached = new Map<string, Installed>();
  const visit = (found: Installed) => {
    if (reached.has(found.path) || found.name.startsWith('@types/')) return;
    reached.set(found.path, found);
    const { entry } = found;
    const required = [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.peerDependencies ?? {}).filter((peer) => !entry.peerDependenciesMeta?.[peer]?.optional),
    ];
    for (const dependency of required) visit(resolveInstalled(packages, dependency, found.path));
  };
  for (const name of direct) visit(resolveInstalled(packages, name));
  return reached;
}

async function load() {
  const notices = await readFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, LockEntry>;
  };

  const installed = (name: string, from = ''): Installed => resolveInstalled(lock.packages, name, from);
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

describe('the bundled-dependency walk', () => {
  const entry = (version: string, extra: Partial<LockEntry> = {}): LockEntry => ({ version, license: 'MIT', ...extra });

  it('finds a nested copy before the hoisted one, and required peers but not optional ones', () => {
    const packages: Record<string, LockEntry> = {
      'node_modules/app-lib': entry('1.0.0', {
        dependencies: { shared: '^2' },
        peerDependencies: { host: '*', extra: '*' },
        peerDependenciesMeta: { extra: { optional: true } },
      }),
      'node_modules/app-lib/node_modules/shared': entry('2.1.0'),
      'node_modules/shared': entry('1.4.0'),
      'node_modules/host': entry('3.0.0'),
      'node_modules/extra': entry('9.0.0'),
    };
    const found = [...bundledClosure(packages, ['app-lib']).values()].map(
      ({ name, entry: { version } }) => `${name}@${version}`,
    );
    expect(found.sort()).toEqual(['app-lib@1.0.0', 'host@3.0.0', 'shared@2.1.0']);
  });
});

describe('THIRD_PARTY_NOTICES.md', () => {
  it('lists every production dependency at the version installed', async () => {
    const { notices, lock, installed } = await load();
    const rows = tableUnder(notices, '## Shipped inside the extension');

    for (const name of Object.keys(lock.packages['']!.dependencies ?? {})) {
      const row = rows.find((cells) => cells[0]!.includes(`\`${name}\``));
      expect(row, `${name} has no row`).toBeDefined();
      // "1.25.2, **modified**" lists 1.25.2.
      const listed = row![1]!.split(',')[0]!.trim();
      const { version } = installed(name).entry;
      expect(matchesListed(version, listed), `${name}: listed ${listed}, installed ${version}`).toBe(true);
    }
  });

  it('lists what those dependencies bring with them, as the lockfile has it', async () => {
    const { notices, lock } = await load();
    const direct = new Set(Object.keys(lock.packages['']!.dependencies ?? {}));

    // What the notices describe: production dependencies and the peer
    // dependencies they require (optional ones, such as PDF.js's Node canvas,
    // are never bundled), without type declarations, which carry no code.
    const reached = bundledClosure(lock.packages, direct);

    // One row per package and version: two versions of one package are both
    // bundled, and both listed.
    const rows = new Map<string, { name: string; version: string; license: string }>();
    for (const { name, entry } of reached.values()) {
      if (direct.has(name)) continue;
      const version = entry.version.split('.').slice(0, 2).join('.');
      rows.set(`${name} ${version}`, { name, version, license: entry.license ?? '' });
    }
    // By name, then version, as the table is written.
    const expected = [...rows.values()]
      .sort((a, b) => (a.name !== b.name ? (a.name < b.name ? -1 : 1) : a.version < b.version ? -1 : 1))
      .map(({ name, version, license }) => [`\`${name}\``, version, license]);

    expect(tableUnder(notices, '### Bundled with the above')).toEqual(expected);
  });

  it('lists every PDF.js file copied into the build', async () => {
    const { notices } = await load();
    const table = tableUnder(notices, '### PDF.js bundled assets').flat().join(' ');
    const pdfjs = resolve(root, 'public/pdfjs');
    expect(existsSync(pdfjs), 'run copy-assets (npm install does)').toBe(true);

    for (const entry of readdirSync(pdfjs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // Directories are listed whole (`cmaps/`), except wasm/, whose
        // modules each carry their own licence and are listed one by one.
        if (entry.name !== 'wasm') expect(table, `${entry.name}/ is copied but not listed`).toContain(`\`${entry.name}/`);
        continue;
      }
      // The library's worker and its licence are what the PDF.js row in the
      // shipped table covers.
      expect(['pdf.worker.min.mjs', 'LICENSE'], `pdfjs/${entry.name} is copied but not accounted for`).toContain(entry.name);
    }

    // As an asset (`wasm/x`) or as a licence file (`pdfjs/wasm/x`). QuickJS,
    // for one, is in the package and must not be here: it runs a PDF's own
    // JavaScript in PDF.js's sandbox, which this extension does not ship.
    for (const name of readdirSync(resolve(pdfjs, 'wasm'))) {
      expect(table, `wasm/${name} is copied but not listed`).toContain(`wasm/${name}\``);
    }
  });
});
