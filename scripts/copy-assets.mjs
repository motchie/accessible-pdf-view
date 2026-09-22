/**
 * Copies the third-party binary assets that must be served from the extension
 * origin into `public/`, where WXT copies them verbatim into the build output.
 *
 * Nothing here is fetched at runtime from a CDN: the extension's CSP only
 * allows `'self'`, and — more importantly — the privacy model requires that
 * opening a PDF causes no network traffic at all.
 *
 * Run automatically via `postinstall`, `dev` and `build`.
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'node_modules');
const publicDir = join(root, 'public');

/** @type {Array<{from: string, to: string, optional?: boolean}>} */
const assets = [
  // NOTE: pdf-inspector's WASM module is NOT copied here. The worker imports
  // it with `?url`, so the bundler emits it once into `assets/`. Copying it
  // would ship a second 4.8 MB copy of the same file.

  // PDF.js worker. Referenced via GlobalWorkerOptions.workerSrc so that the
  // large worker bundle is not pulled through Vite.
  {
    from: join(modules, 'pdfjs-dist/build/pdf.worker.min.mjs'),
    to: join(publicDir, 'pdfjs/pdf.worker.min.mjs'),
  },

  // CMaps are required to decode CJK text in Original mode. Japanese PDFs are
  // a first-class target for this project, so these are not optional.
  { from: join(modules, 'pdfjs-dist/cmaps'), to: join(publicDir, 'pdfjs/cmaps') },
  {
    from: join(modules, 'pdfjs-dist/standard_fonts'),
    to: join(publicDir, 'pdfjs/standard_fonts'),
  },
  // Image decoders (JBIG2 / JPEG2000) and the colour-management module that
  // PDF.js v5+ ships as WebAssembly. Scanned PDFs frequently need these.
  { from: join(modules, 'pdfjs-dist/wasm'), to: join(publicDir, 'pdfjs/wasm') },
  // Apache-2.0 requires the license to travel with redistributions, and the
  // built extension is a redistribution.
  { from: join(modules, 'pdfjs-dist/LICENSE'), to: join(publicDir, 'pdfjs/LICENSE') },
  { from: join(modules, 'pdfjs-dist/iccs'), to: join(publicDir, 'pdfjs/iccs'), optional: true },
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

await rm(join(publicDir, 'wasm'), { recursive: true, force: true });
await rm(join(publicDir, 'pdfjs'), { recursive: true, force: true });

for (const asset of assets) {
  if (!(await exists(asset.from))) {
    if (asset.optional) continue;
    throw new Error(
      `Missing asset ${asset.from}. Run \`npm install\` before building.`,
    );
  }
  await mkdir(dirname(asset.to), { recursive: true });
  await cp(asset.from, asset.to, { recursive: true });
}

console.log('copy-assets: public/pdfjs is up to date.');
