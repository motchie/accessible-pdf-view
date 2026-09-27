# pdf-inspector 1.23.0, with the bcmap fix

A build of [pdf-inspector](https://github.com/firecrawl/pdf-inspector)'s
WebAssembly package that is not the one on npm. It is here for one reason, and
it goes away when that reason does.

## Why

pdf-inspector's reader for pdf.js binary CMaps did not decode their delta
encoding, so every bundled `Adobe-*-UCS2.bcmap` failed to parse
([firecrawl/pdf-inspector#573](https://github.com/firecrawl/pdf-inspector/issues/573)).
A CID font with no ToUnicode CMap therefore never got its character collection's
mapping, and its text came out as noise. Two of the ten documents in the
private fixture set are made this way, one of them the InDesign flyer that
was reported, and the inferred reading and the Markdown view of both were
unreadable
([accessible-pdf-view#1](https://github.com/motchie/accessible-pdf-view/issues/1)).

The fix is offered upstream as
[firecrawl/pdf-inspector#594](https://github.com/firecrawl/pdf-inspector/pull/594).
Until a release carries it, the extension ships this build.

## What it is

- **Source:** [`motchie/pdf-inspector`, branch `apv/1.23.0-bcmap-fix`](https://github.com/motchie/pdf-inspector/tree/apv/1.23.0-bcmap-fix),
  commit `d1ce6af47ef2c8672fc0c964913e0f8814d63674` — the upstream tag
  `v1.23.0` plus the two commits of #594. The first makes the CMaps parse at
  all; the second makes every mapping in them read as pdf.js reads it,
  characters outside the BMP included, which the first left as U+FFFD.
- **Built with:** rustc 1.98.0 (the version upstream pins), wasm-pack 0.15.0,
  the command upstream's release workflow uses:

  ```bash
  wasm-pack build wasm --target web --scope firecrawl --out-dir pkg --release
  ```

- **`pdf_inspector_wasm_bg.wasm`** SHA-256
  `8a5694310e8bd89e9f5e5a3a884c7448a1c81127cc0129ce5472cbb3ca638c21`.
  The JavaScript glue and the type declarations are byte-identical to npm's
  1.23.0.
- **`package.json`** is the generated one with three fields changed: the
  version, marked `1.23.0-apv.2`; the description, which says what this build
  is; and `files`, which gains this README and the licence.

## What it changes

Measured against the private fixture set: an unpatched build from the same tag
with the same toolchain gives output identical to npm's 1.23.0 on all ten
documents, so the build itself changes nothing. This build changes two of the
ten — the two with CID fonts that have no ToUnicode — and in both the text
now matches what poppler reads. The other eight are identical.

The second commit changes none of the ten, because none of them uses a
character outside the BMP. On a document built for it — a non-embedded
Adobe-Japan1 font, no ToUnicode, showing あ, CID 7641 and あ — the first build
read `あ�あ` and this one reads `あ𨳝あ`, as poppler does.

## When it goes

When a pdf-inspector release on npm contains the fix: point `package.json` back
at `@firecrawl/pdf-inspector-wasm` on npm, delete this directory, and update the
pdf-inspector row of `THIRD_PARTY_NOTICES.md`.

## Licence

MIT, as upstream. `LICENSE` is upstream's, and includes the BSD-3-Clause notice
for the Adobe CMaps the binary embeds.
