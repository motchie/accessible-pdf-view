# Third-party notices

Accessible PDF View is distributed under the MIT License. It includes or
depends on the following third-party components.

## Shipped inside the extension

These are packaged into the built extension and distributed to users.

| Component | Version | License | Notes |
| --- | --- | --- | --- |
| [pdf-inspector](https://github.com/firecrawl/pdf-inspector) (`@firecrawl/pdf-inspector-wasm`) | 1.25.0, **modified** | MIT | The Rust core compiled to WebAssembly. Built from 1.25.0 plus one fix in two commits, not taken from npm; see below. |
| [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | 6.4.299 | Apache-2.0 | Library, worker, CMaps, standard fonts, and the image-decoder WebAssembly modules are shipped. |
| [React](https://github.com/facebook/react) (`react`, `react-dom`) | 19.3 | MIT | |
| [mdast-util-from-markdown](https://github.com/syntax-tree/mdast-util-from-markdown) (`mdast-util-from-markdown`) | 2.1 | MIT | |
| [mdast-util-gfm-table](https://github.com/syntax-tree/mdast-util-gfm-table) (`mdast-util-gfm-table`) | 2.0 | MIT | |
| [micromark-extension-gfm-table](https://github.com/micromark/micromark-extension-gfm-table) (`micromark-extension-gfm-table`) | 2.1 | MIT | |
| [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) (Braille Institute) | variable, `wght` 200–800 | OFL-1.1 | The upright and italic variable fonts, shipped verbatim. See below. |

### Bundled with the above

The packages the components above depend on, which the bundler pulls into the
build with them: everything their production dependencies reach, by
`package-lock.json`, apart from type declarations (`@types/*`, no code) and
PDF.js's optional Node-only canvas (`@napi-rs/canvas`, never bundled).
Tree-shaking may leave some of them out of the output.
`tests/third-party-notices.test.ts` fails when this list and the lockfile
disagree.

| Package | Version | License |
| --- | --- | --- |
| `character-entities` | 2.0 | MIT |
| `debug` | 4.4 | MIT |
| `decode-named-character-reference` | 1.3 | MIT |
| `dequal` | 2.0 | MIT |
| `devlop` | 1.1 | MIT |
| `longest-streak` | 3.1 | MIT |
| `markdown-table` | 3.0 | MIT |
| `mdast-util-phrasing` | 4.1 | MIT |
| `mdast-util-to-markdown` | 2.2 | MIT |
| `mdast-util-to-string` | 4.0 | MIT |
| `micromark` | 4.0 | MIT |
| `micromark-core-commonmark` | 2.0 | MIT |
| `micromark-factory-destination` | 2.0 | MIT |
| `micromark-factory-label` | 2.0 | MIT |
| `micromark-factory-space` | 2.1 | MIT |
| `micromark-factory-title` | 2.0 | MIT |
| `micromark-factory-whitespace` | 2.0 | MIT |
| `micromark-util-character` | 2.1 | MIT |
| `micromark-util-chunked` | 2.0 | MIT |
| `micromark-util-classify-character` | 2.0 | MIT |
| `micromark-util-combine-extensions` | 2.0 | MIT |
| `micromark-util-decode-numeric-character-reference` | 2.0 | MIT |
| `micromark-util-decode-string` | 2.0 | MIT |
| `micromark-util-edit-map` | 1.0 | MIT |
| `micromark-util-encode` | 2.0 | MIT |
| `micromark-util-html-tag-name` | 2.0 | MIT |
| `micromark-util-normalize-identifier` | 2.0 | MIT |
| `micromark-util-resolve-all` | 2.0 | MIT |
| `micromark-util-sanitize-uri` | 2.0 | MIT |
| `micromark-util-subtokenize` | 2.1 | MIT |
| `micromark-util-symbol` | 2.0 | MIT |
| `micromark-util-types` | 2.0 | MIT |
| `ms` | 2.1 | MIT |
| `scheduler` | 0.28 | MIT |
| `unist-util-is` | 6.0 | MIT |
| `unist-util-stringify-position` | 4.0 | MIT |
| `unist-util-visit` | 5.2 | MIT |
| `unist-util-visit-parents` | 6.1 | MIT |
| `zwitch` | 2.0 | MIT |

### Atkinson Hyperlegible Next

`public/fonts/` carries the two variable fonts and the licence they are used
under, all three reaching the build output unchanged:

| Asset | License file in build |
| --- | --- |
| `fonts/AtkinsonHyperlegibleNext-Variable.ttf` | `fonts/OFL.txt` |
| `fonts/AtkinsonHyperlegibleNext-Italic-Variable.ttf` | `fonts/OFL.txt` |

Taken from [google/fonts](https://github.com/google/fonts/tree/main/ofl/atkinsonhyperlegiblenext)
and **unmodified** — the files match the upstream blob hashes byte for byte, and
only their names lost the square brackets a URL would have had to escape. Not
subsetted and not converted, which also keeps them clear of the OFL's reserved
font names, `ATKINSON` and `HYPERLEGIBLE`: a modified version could not have
carried either.

Copyright 2020–2024 The Atkinson Hyperlegible Next Project Authors.

### pdf-inspector

`pdf_inspector_wasm_bg.wasm` is not npm's. It is built from upstream's 1.25.0
release commit plus the two commits of one fix to the decoding of the CMaps the binary embeds
([firecrawl/pdf-inspector#594](https://github.com/firecrawl/pdf-inspector/pull/594)),
and it lives in `vendor/pdf-inspector-wasm/` with its source, build command and
hash in the README there. It returns to the npm package when a release carries
the fix.

The binary embeds Adobe's CMap resources, under the BSD-3-Clause licence.
Upstream's `LICENSE` carries that notice as well as pdf-inspector's own MIT
licence, and `scripts/copy-assets.mjs` copies it into every build as
`pdf-inspector/LICENSE`.

### PDF.js bundled assets

`scripts/copy-assets.mjs` vendors the following from `pdfjs-dist` into
`public/pdfjs/`, each retaining its upstream license file in the build output.
QuickJS (`wasm/quickjs-eval.*`) is in the package but deliberately not copied:
only PDF.js's scripting sandbox uses it, and the extension ships neither.

| Asset | License file in build |
| --- | --- |
| `standard_fonts/` (Foxit fonts) | `pdfjs/standard_fonts/LICENSE_FOXIT` |
| `standard_fonts/` (Liberation fonts) | `pdfjs/standard_fonts/LICENSE_LIBERATION` |
| `wasm/jbig2.wasm` | `pdfjs/wasm/LICENSE_JBIG2`, `pdfjs/wasm/LICENSE_PDFJS_JBIG2` |
| `wasm/openjpeg.wasm` | `pdfjs/wasm/LICENSE_OPENJPEG`, `pdfjs/wasm/LICENSE_PDFJS_OPENJPEG` |
| `wasm/jbig2_nowasm_fallback.js`, `wasm/openjpeg_nowasm_fallback.js` (the same decoders, for when WebAssembly is unavailable) | As the `.wasm` beside each |
| `wasm/qcms_bg.wasm` | `pdfjs/wasm/LICENSE_QCMS`, `pdfjs/wasm/LICENSE_PDFJS_QCMS` |
| `iccs/` | `pdfjs/iccs/LICENSE` |
| `cmaps/` | Covered by the PDF.js Apache-2.0 license. |

## Build and development only

Not distributed to users.

| Component | Version | License |
| --- | --- | --- |
| [WXT](https://github.com/wxt-dev/wxt) | 0.21 | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | 5.0 | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | 7.0 | Apache-2.0 |

---

Apache-2.0 requires that the license and any NOTICE be reproduced with
redistributions. The `pdfjs-dist` package's `LICENSE` file is present in
`node_modules/pdfjs-dist/LICENSE`, and the per-asset license files listed above
are copied into every build.
