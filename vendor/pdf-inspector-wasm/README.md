# pdf-inspector 1.25.2, with the bcmap fix

A build of [pdf-inspector](https://github.com/firecrawl/pdf-inspector)'s
WebAssembly package that is not the one on npm. It is here for one reason, and
it goes away when that reason does.

## Why

pdf-inspector's reader for pdf.js binary CMaps did not decode their delta
encoding, so every bundled `Adobe-*-UCS2.bcmap` failed to parse
([firecrawl/pdf-inspector#573](https://github.com/firecrawl/pdf-inspector/issues/573)).
A CID font with no ToUnicode CMap therefore never got its character collection's
mapping, and its text came out as noise. Two of the documents in the
private fixture set are made this way, one of them the InDesign flyer that
was reported, and the inferred reading and the Markdown view of both were
unreadable
([accessible-pdf-view#1](https://github.com/motchie/accessible-pdf-view/issues/1)).

The fix is offered upstream as
[firecrawl/pdf-inspector#594](https://github.com/firecrawl/pdf-inspector/pull/594).
Until a release carries it, the extension ships this build.

## What it is

- **Source:** [`motchie/pdf-inspector`, branch `apv/1.25.2-bcmap-fix`](https://github.com/motchie/pdf-inspector/tree/apv/1.25.2-bcmap-fix),
  commit `2c3e0c5e0d05aec219649a61fb8cf3f9788711ce` — upstream's 1.25.2 release
  commit (`ef52f77`, "bump package versions to 1.25.2"; the release has no tag)
  plus the two commits of #594, cherry-picked unchanged; they apply cleanly.
  The first commit makes the CMaps parse at all; the second makes every mapping
  in them read as pdf.js reads it, characters outside the BMP included, which
  the first left as U+FFFD.
- **Built with:** rustc 1.98.0 (the version upstream pins), wasm-pack 0.15.0,
  the command upstream's release workflow uses:

  ```bash
  wasm-pack build wasm --target web --scope firecrawl --out-dir pkg --release
  ```

  `cargo test --release` passes on that commit, including the fix's own tests
  (`ucs2_cmaps_read_characters_outside_the_bmp` among them).
- **`pdf_inspector_wasm_bg.wasm`** SHA-256
  `a46e99c1c48c526638efb2d4a1fef43fb378fcae963dedbcd6918ad2f2760ab4`.
  The JavaScript glue and the type declarations are byte-identical to npm's
  1.25.2, which are themselves identical to 1.25.0's.
- **`package.json`** is the generated one with three fields changed: the
  version, marked `1.25.2-apv.1`; the description, which says what this build
  is; and `files`, which gains this README and the licence.

## What it changes

Measured on the fourteen documents the tests use (the private fixture set and
`tests/fixtures/word/word-basic.pdf`), comparing `processPdf` results with the
Reader's options, timing aside:

- **The build itself changes nothing:** an unpatched build from the same commit
  with the same toolchain gives results identical to npm's 1.25.2 on all
  fourteen, though the binaries differ byte for byte.
- **The fix changes two:** the two with CID fonts that have no ToUnicode.
  npm's 1.25.2 reads the InDesign flyer as 0 Japanese characters and 337
  U+FFFD, and this build reads 579 and none; the other document goes from
  6,068 and 1,455 to 7,824 and none. The other twelve are identical.
- **Against the 1.25.0 build it replaces,** the results are identical on all
  fourteen. Upstream's 1.25.1 and 1.25.2 fix text extraction from simple and
  Type1 fonts and subset ToUnicode repairs (#595, #596, #597, #603, #605); none
  of these documents exercises them.

## When it goes

When a pdf-inspector release on npm contains the fix: point `package.json` back
at `@firecrawl/pdf-inspector-wasm` on npm, delete this directory, and update the
pdf-inspector row of `THIRD_PARTY_NOTICES.md`.

## Licence

MIT, as upstream. `LICENSE` is upstream's, and includes the BSD-3-Clause notice
for the Adobe CMaps the binary embeds.
