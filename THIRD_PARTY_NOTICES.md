# Third-party notices

Accessible PDF View is distributed under the MIT License. It includes or
depends on the following third-party components.

## Shipped inside the extension

These are packaged into the built extension and distributed to users.

| Component | Version | License | Notes |
| --- | --- | --- | --- |
| [pdf-inspector](https://github.com/firecrawl/pdf-inspector) (`@firecrawl/pdf-inspector-wasm`) | 1.23.0, **modified** | MIT | The Rust core compiled to WebAssembly. Built from 1.23.0 plus one fix, not taken from npm; see below. |
| [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | 6.2.108 | Apache-2.0 | Library, worker, CMaps, standard fonts, and the image-decoder WebAssembly modules are shipped. |
| [React](https://github.com/facebook/react) | 19.2 | MIT | |
| [mdast-util-from-markdown](https://github.com/syntax-tree/mdast-util-from-markdown) | 2.0 | MIT | |
| [mdast-util-gfm-table](https://github.com/syntax-tree/mdast-util-gfm-table) | 2.0 | MIT | |
| [micromark-extension-gfm-table](https://github.com/micromark/micromark-extension-gfm-table) | 2.1 | MIT | |
| [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) (Braille Institute) | variable, `wght` 200–800 | OFL-1.1 | The upright and italic variable fonts, shipped verbatim. See below. |

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

`pdf_inspector_wasm_bg.wasm` is not npm's. It is built from the `v1.23.0` tag
plus one commit, which fixes the decoding of the CMaps the binary embeds
([firecrawl/pdf-inspector#594](https://github.com/firecrawl/pdf-inspector/pull/594)),
and it lives in `vendor/pdf-inspector-wasm/` with its source, build command and
hash in the README there. It returns to the npm package when a release carries
the fix.

The binary embeds Adobe's CMap resources, under the BSD-3-Clause licence;
upstream's `LICENSE`, beside the binary in `vendor/pdf-inspector-wasm/`, carries
that notice as well as pdf-inspector's own MIT licence.

### PDF.js bundled assets

`scripts/copy-assets.mjs` vendors the following from `pdfjs-dist` into
`public/pdfjs/`, each retaining its upstream license file in the build output:

| Asset | License file in build |
| --- | --- |
| `standard_fonts/` (Foxit fonts) | `pdfjs/standard_fonts/LICENSE_FOXIT` |
| `standard_fonts/` (Liberation fonts) | `pdfjs/standard_fonts/LICENSE_LIBERATION` |
| `wasm/jbig2.wasm` | `pdfjs/wasm/LICENSE_JBIG2`, `pdfjs/wasm/LICENSE_PDFJS_JBIG2` |
| `wasm/openjpeg.wasm` | `pdfjs/wasm/LICENSE_OPENJPEG`, `pdfjs/wasm/LICENSE_PDFJS_OPENJPEG` |
| `wasm/qcms_bg.wasm` | `pdfjs/wasm/LICENSE_QCMS`, `pdfjs/wasm/LICENSE_PDFJS_QCMS` |
| `iccs/` | `pdfjs/iccs/LICENSE` |
| `cmaps/` | Covered by the PDF.js Apache-2.0 license. |

## Build and development only

Not distributed to users.

| Component | Version | License |
| --- | --- | --- |
| [WXT](https://github.com/wxt-dev/wxt) | 0.21 | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | 4.1 | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | 5.9 | Apache-2.0 |

---

Apache-2.0 requires that the license and any NOTICE be reproduced with
redistributions. The `pdfjs-dist` package's `LICENSE` file is present in
`node_modules/pdfjs-dist/LICENSE`, and the per-asset license files listed above
are copied into every build.
