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
  commit `3f43343a175fff69063ce0bf9a6b97d63d5cfbca` — the upstream tag
  `v1.23.0` plus the one commit of #594.
- **Built with:** rustc 1.98.0 (the version upstream pins), wasm-pack 0.15.0,
  the command upstream's release workflow uses:

  ```bash
  wasm-pack build wasm --target web --scope firecrawl --out-dir pkg --release
  ```

- **`pdf_inspector_wasm_bg.wasm`** SHA-256
  `6e4d24da75a4b637a1030eda0b939f0481d50f56c1e6d1b01a1a959eca700850`.
  The JavaScript glue and the type declarations are byte-identical to npm's
  1.23.0.
- **`package.json`** is the generated one, with the version marked
  `1.23.0-apv.1` and this README and the licence added to `files`.

## What it changes

Measured against the private fixture set: an unpatched build from the same tag
with the same toolchain gives output identical to npm's 1.23.0 on all ten
documents, so the build itself changes nothing. This build changes two of the
ten — the two with CID fonts that have no ToUnicode — and in both the text
now matches what poppler reads. The other eight are identical.

## When it goes

When a pdf-inspector release on npm contains the fix: point `package.json` back
at `@firecrawl/pdf-inspector-wasm` on npm, delete this directory, and update the
pdf-inspector row of `THIRD_PARTY_NOTICES.md`.

## Licence

MIT, as upstream. `LICENSE` is upstream's, and includes the BSD-3-Clause notice
for the Adobe CMaps the binary embeds.
