# PowerPoint fixtures

A deck written for this project, so it can be published, like the Word fixtures
beside it (`../word/README.md`).

- `pptx-small-figures.pptx` — four slides of small figures, with and without
  alternative text: icons, day-of-week badges drawn as shapes and as pictures,
  a route drawn from small shapes both loose and grouped, rules marked
  Decorative and not, and a chart for contrast. It was generated with
  python-pptx (hence the description property) and then saved by PowerPoint.
  The last-modified-by property is blanked: PowerPoint fills it with the
  account's name.
- `pptx-small-figures.pdf` — exported from it by PowerPoint for Microsoft 365
  (`/Producer` "Microsoft® PowerPoint® for Microsoft 365"; the exact build was
  not recorded), with document structure tags on.

What the export shows about PowerPoint, which the tests rely on:

- A shape given no alternative text is a `Figure` with an empty `/Alt ()`. A
  picture given none has no `/Alt`. A picture marked Decorative is an
  artifact, outside the tag tree (#27).
- A group's alternative text gets 「 (グループ化されたオブジェクト)」 appended
  (#28).
- A shape with text in it (the badges) is tagged as text, not as a `Figure`.

`tests/powerpoint-figures.test.ts` reads slide 3. The deck is also a sample for
#15, the size below which a figure is not shown.

Making the source: python-pptx writes each picture's file name into its
alternative text unless that is removed, which the first export here did not
do. Check `descr` in the slides before exporting.
