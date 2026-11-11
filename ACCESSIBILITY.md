# Accessibility

日本語版: [ACCESSIBILITY.ja.md](ACCESSIBILITY.ja.md)

Accessible PDF View exists to remove one barrier. A PDF that was never tagged —
which is most of them — has no heading structure, no list structure, no table
structure and no reading order for assistive technology to work with. The text
is there; the document is not. This extension rebuilds it as semantic HTML.

A tool with that purpose owes its users a statement of what it commits to, what
it is known to get wrong, and how to report it when it fails them. That is what
this file is.

## Priorities and goals

Two different things here have to be accessible, and they are not the same job:

1. **The extension's own interface** — the Reader's toolbar, the document
   information panel, the structure picker, the settings side panel.
2. **The document the Reader produces** — the HTML rebuilt from the PDF, which
   is the whole point of the extension.

For both, the target is **WCAG 2.2 Level AA**.

That is a target, not a conformance claim. No conformance evaluation has been
carried out, so there is no evaluated scope, date, method or evaluator to cite —
and without those, a claim would mean nothing. If an evaluation is done, it will
be published here with all four.

What gets attention first, because it is what the extension is for:

- **Reading with a screen reader in browse mode**: heading navigation (`H`,
  `1`–`6`), list navigation, table navigation with real row and column headers,
  link navigation and the links list, and the browser's own find.
- **Keyboard-only operation** of the Reader and the settings panel.
- **Japanese documents**, including the CID-font text that other readers turn
  into noise. This project exists for documents in a script where a silent
  failure is hardest to notice.
- **Being told the truth about the document.** This is a design rule, not a
  feature: no message in this extension says something the extension does not
  know. A page that could not be read is reported as not read, never as empty.
  Text a word processor generated is labelled as generated, never presented as
  the author's own words. Focus is never moved for you; work that takes minutes
  says so while it runs, through a live region that was in the page from the
  start.

## Contributor expectations

This applies to human contributors and to coding agents alike.

- **`npm run compile` and `npm test` have to pass.** CI runs both, plus a
  build, on every pull request.
- **Native HTML first.** Reach for ARIA only where HTML genuinely cannot
  express something.
- **Do not move the user's focus**, and do not create a live region at the
  moment you first want to announce something — a region created with its first
  message in it is frequently announced by nothing. Use the `role="status"`
  region that is already in the page.
- **Every interface string exists in both languages.** `lib/i18n/en.ts` is the
  type and `ja.ts` is declared as it, so a message missing from Japanese fails
  `tests/i18n.test.ts` and a message missing from English fails the
  type-check.
- **Never present machine-produced text as the author's own.** The test suite
  pins this, along with "we could not read this page" never being written as
  "there is nothing here".
- **Say what you checked, and with what.** If a change alters what a screen
  reader hears, write in the pull request which browser, operating system and
  screen reader you used, and what you heard. If you could not check it, write
  that instead. An unverified change can still be merged; an unverified claim
  cannot. [#33](https://github.com/motchie/accessible-pdf-view/issues/33) and
  [#34](https://github.com/motchie/accessible-pdf-view/issues/34) are what a
  check written down looks like.
- **Coding agents cannot run a screen reader.** Say so rather than describing
  expected output as observed output. Report what you did observe — the
  accessibility tree, a `uiautomator` or MSAA dump, a test assertion — and name
  the tool that produced it.

## Reporting accessibility barriers

**[Report an accessibility
barrier](https://github.com/motchie/accessible-pdf-view/issues/new?template=accessibility-barrier.yml)**
— a GitHub issue, labelled
[`accessibility`](https://github.com/motchie/accessible-pdf-view/issues?q=is%3Aissue+label%3Aaccessibility).

- **English or Japanese**, whichever you would rather write. Both are read.
- **You do not need to say anything about yourself or your disability.** What is
  useful is what happened, not who it happened to.
- **No screenshot, recording or sample file is required.** A description in your
  own words is a complete report. Every field on the form except the first is
  optional.
- Useful if you have it: what you were trying to do, what the extension said or
  did, what you expected instead, the browser and its version, the operating
  system, and the assistive technology and its version.
- **A PDF this extension reads badly is the most useful report there is.** It is
  worth more than any item on the roadmap, because those were written by
  guessing at what would matter. If the document cannot be shared — most real
  documents cannot be — say so, and the issue gets the `needs-sample` label
  while a stand-in is looked for.

## Response process

One person maintains this project, so what is promised here is small, and it is
what can actually be delivered:

- **An acknowledgement on the issue**, saying what is understood about the
  barrier so far: whether it reproduces here, or what is missing before it can
  be tried.
- **Triage by label**: `accessibility` plus whichever of `bug`,
  `nonconforming-pdf` (the PDF deviates from the spec and the tool should still
  cope), `upstream` (PDF.js or pdf-inspector), `japanese` and `needs-sample`
  apply.
- **No severity labels exist today.** If you say how badly it blocks you, that
  goes in the issue and the maintainer confirms or revises the weighting during
  triage — it is not treated as a formal severity.
- **No response time is promised.** There is no team behind this, and a
  deadline that cannot be met is worse than none.
- **A fix lands on `main` first**, where the issue gets `fixed-unreleased`,
  because the extension in your browser comes from a store release and that can
  be days or weeks later. The issue says when the release goes out.
- **You are invited to check the fix**, from the source build or from the
  release.
- **An issue that will not be fixed is closed with the reason**, labelled
  `wontfix`.
  [#17](https://github.com/motchie/accessible-pdf-view/issues/17) is an example:
  the request was reasonable and the answer was a judgement about a trade-off,
  which is stated in the issue rather than left implicit.

## Supported environments

| | |
| --- | --- |
| Chrome, Edge | **147 or later**, Manifest V3 |
| Firefox (desktop) | **144 or later**, Manifest V3 |

The floor is declared in the manifest and listed in
`lib/browser/minimum-versions.ts`: it is what the bundled PDF.js calls without
checking for it first, so an older browser would not fail cleanly
([#23](https://github.com/motchie/accessible-pdf-view/issues/23)).

What that support actually amounts to:

- **Chrome is the tested browser.** The code avoids `chrome.*` in favour of
  WXT's `browser` API and both targets are Manifest V3, but Firefox has been run
  far less and Edge has not been run at all.
- **Firefox for Android is not supported** and the extension is not listed for
  it. It has been loaded onto a device to investigate
  [#33](https://github.com/motchie/accessible-pdf-view/issues/33), and that is
  all.
- **Image descriptions and OCR are Chrome-only**, because they use Chrome's
  on-device model. Firefox's equivalent, `browser.trial.ml`, is on Release
  behind two `about:config` flags, and an accessibility feature that needs
  `about:config` is a feature for people who do not need this extension. On
  Firefox those panels leave themselves out and say why.
- **Assistive technology this project has been checked against**, when a
  specific question needed it rather than on a schedule, each with the browser
  it was used in:
  **NVDA** with Firefox on Windows
  ([#33](https://github.com/motchie/accessible-pdf-view/issues/33),
  [#34](https://github.com/motchie/accessible-pdf-view/issues/34)),
  **VoiceOver** with Chrome on macOS
  ([#19](https://github.com/motchie/accessible-pdf-view/issues/19)), and
  **TalkBack** with Firefox for Android
  ([#33](https://github.com/motchie/accessible-pdf-view/issues/33)).
- **There is no per-release screen reader test matrix.** What runs on every
  change is the test suite and a build; nothing in CI listens. Treat a claim
  about a particular screen reader as true only where an issue or a pull
  request says it was checked there.

## Known limitations

Described as what a reader runs into. The full lists are
[README § Current limitations](README.md#current-limitations) and
[ROADMAP.md](ROADMAP.md); the open ones are tracked under the
[`accessibility`
label](https://github.com/motchie/accessible-pdf-view/issues?q=is%3Aissue+is%3Aopen+label%3Aaccessibility).

- **In Firefox, the Reader's static content is exposed as clickable**
  ([#33](https://github.com/motchie/accessible-pdf-view/issues/33)). With
  TalkBack, the status line, headings, paragraphs and the toolbar rows are
  announced as something to double-tap, and double-tapping does nothing. The
  cause is measured — React's listeners on the root element — and the fix is a
  change to how the Reader is mounted, not yet made. **Workaround: Chrome 155
  or later**, where the counterpart problem
  ([#19](https://github.com/motchie/accessible-pdf-view/issues/19)) went away.
  Chrome 147 to 154 is not a way round it: #19 was closed because Chrome
  changed, not because this extension did, so with VoiceOver the same cause is
  still announced there.
- **A radio's description is spoken as part of its name** in the structure
  picker and the settings panel
  ([#34](https://github.com/motchie/accessible-pdf-view/issues/34)), so the
  whole explanation is repeated every time the radio is reached. A fix is open
  as [#35](https://github.com/motchie/accessible-pdf-view/pull/35).
- **A tagged PDF whose tags carry no headings gives a flat outline.** The
  combined reading recovers headings where it can verify them against the page,
  but it cannot invent a level. This is the common case in business documents,
  not the exception.
- **An image-only PDF can be viewed but not read as text** unless Chrome's
  on-device model is available. That model is a general-purpose one, not an OCR
  engine: it is labelled experimental, and its accuracy on Japanese scans is
  unmeasured.
- **Ordinary text trapped inside a malformed table stays there.** A parser that
  reads a page as one enormous table hides the text in cells, and detecting that
  unreliably would move real tables out of the document, which is worse.
- **A local (`file://`) PDF and a `blob:` PDF cannot be opened.** The Reader
  says which it was and why, rather than failing silently.
- **A link in a tagged PDF whose annotation rectangle does not overlap its text
  falls back to plain text**, because annotations are matched to structure
  elements by position.
- **Where the two readings of a document disagree, the Reader offers a switch
  rather than a report.** You have to try both to find out what differs.

## Ownership and maintenance

Maintained by [@motchie](https://github.com/motchie), who is one person and not
a team. This file, and the practices in it, are reviewed at each release;
anything in it that has gone stale is a bug in the file and worth reporting as
one.

**Last reviewed: 2026-11-11, against version 0.2.4.**

## Feedback and improvements

Suggestions about this statement, or about how the project handles
accessibility, are welcome as an issue labelled `documentation` and
`accessibility`, or as a pull request against this file. Disagreement about
whether something is a barrier at all is worth filing too — the answer belongs
in a public issue rather than in one person's head.
