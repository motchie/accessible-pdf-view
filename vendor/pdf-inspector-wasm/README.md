# pdf-inspector 1.25.0, with the bcmap fix

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

- **Source:** [`motchie/pdf-inspector`, branch `apv/1.25.0-bcmap-fix`](https://github.com/motchie/pdf-inspector/tree/apv/1.25.0-bcmap-fix),
  commit `708e4f95326b22c61eb56c065bec4e294243dea8` — upstream's 1.25.0 release
  commit (`2dbd16b`, "bump package versions to 1.25.0"; the release has no tag)
  plus the two commits of #594, which is exactly that pull request's branch.
  The first commit makes the CMaps parse at all; the second makes every mapping
  in them read as pdf.js reads it, characters outside the BMP included, which
  the first left as U+FFFD.
- **Built with:** rustc 1.98.0 (the version upstream pins), wasm-pack 0.15.0,
  the command upstream's release workflow uses:

  ```bash
  wasm-pack build wasm --target web --scope firecrawl --out-dir pkg --release
  ```

- **`pdf_inspector_wasm_bg.wasm`** SHA-256
  `ad47f5e7d2185879af34fb423abaa88ce4b34f41e5c36c26887bc66526848b92`.
  The JavaScript glue and the type declarations are byte-identical to npm's
  1.25.0.
- **`package.json`** is the generated one with three fields changed: the
  version, marked `1.25.0-apv.1`; the description, which says what this build
  is; and `files`, which gains this README and the licence.

## What it changes

Measured against the private fixture set:

- An unpatched build from the same commit with the same toolchain gives output
  identical to npm's 1.25.0 on all ten documents, so the build itself changes
  nothing.
- This build changes two of the ten — the two with CID fonts that have no
  ToUnicode — and in both the text now matches what poppler reads. The other
  eight are identical.
- None of the ten uses a character outside the BMP. On a document built for
  it — a non-embedded Adobe-Japan1 font, no ToUnicode, showing あ, CID 7641
  and あ — npm's 1.25.0 reads `���` and this build `あ𨳝あ`, as poppler does.

Against the 1.23.0 build it replaces, the Markdown is identical on all ten.
What 1.24 and 1.25 add to the result are the document information entries
(`author`, `creator`, dates and so on), which the extension does not read — it
takes them from PDF.js.

## When it goes

When a pdf-inspector release on npm contains the fix: point `package.json` back
at `@firecrawl/pdf-inspector-wasm` on npm, delete this directory, and update the
pdf-inspector row of `THIRD_PARTY_NOTICES.md`.

## Licence

MIT, as upstream. `LICENSE` is upstream's, and includes the BSD-3-Clause notice
for the Adobe CMaps the binary embeds.
