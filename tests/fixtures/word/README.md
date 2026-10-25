# Word fixtures

Documents written for this project, so unlike the third-party PDFs the private
suites use, they can be published.

- `word-basic.docx` — the source document, in Japanese: headings, a link,
  bulleted, nested and numbered lists, a table with a header row, a described
  chart, a decorative image, a running header and footer, and a second page.
  It was first written by a script with python-docx (hence the description
  property) and then saved by Word, so what is committed is Word's own file.
  The last-modified-by property is blanked before committing: Word fills it
  with the account's name.
- `word-basic.pdf` — exported from that file by Word for Microsoft 365 MSO,
  version 2609 (build 16.0.20430.20032, 64-bit, Windows), with **Document
  structure tags for accessibility** turned on and PDF/A off. The page is
  Letter, so the chart moves to page 2 and the manual page break puts the
  heading 「2ページ目」 on page 3.
- `known-gaps.ts` — where the reading is known to fall short of an outline,
  and whether the cause is in the PDF (`producer`) or in the Reader
  (`reader`). The outline keeps the ideal; a gap says what is exposed instead.
  A gap that closes fails the test until it is removed.
- `word-basic.outline` — what the Reader should expose for the PDF, as an
  accessibility outline (format: `tests/helpers/outline.ts`). It is written by
  hand from what the document means — never generated from the Reader's
  current output, which would make the test agree with whatever the Reader
  happens to do.

`tests/outline-harness.test.tsx` reads the PDF the way the Reader does, renders
it with the interface in Japanese, and compares the result with the outline.
It is never skipped: these files are committed, so a missing one is a failure.

## Adding a fixture

1. Write the document in Word, and keep the `.docx` here, with its
   last-modified-by property blanked.
2. Export it to PDF with structure tags turned on.
3. Write `<name>.outline` from the `.docx` — what each heading, list, table
   and picture is meant to be — not from the Reader's output. Comment anything
   decided rather than obvious, and anything that must be absent.
4. Add the name to the fixture tests in `outline-harness.test.tsx` and in
   `outline.test.ts` (which checks every committed outline parses).
5. Run `npx vitest run tests/outline-harness.test.tsx`. A failure prints a
   numbered diff; decide whether the expectation, the producer or the Reader
   is wrong before changing anything. Fix a wrong expectation in the outline;
   record a producer's shortfall, or a Reader one not fixed yet, in
   `known-gaps.ts`.
6. Record the producer's exact version above: the test result depends on it.
