# Roadmap

What is not built yet. It is short on purpose.

This file used to be the other thing — a long record of what was decided and
why, item by item, mostly finished. That record was useful while the extension
was being built and nobody had used it, and it is the wrong document to publish
as a plan: a roadmap whose first nine tenths is history tells a reader what
already happened, which they can read in the code and its comments, and almost
nothing about what to expect.

So this starts small. **The next version of it should come from people who have
used the extension**, not from the person who wrote it. Nothing below is a
promise; several of these have been sitting here precisely because no reader has
yet said they matter.

## Known gaps, in rough order of how often they would bite

- **A tagged PDF whose tags carry no headings** is the common case in the
  business documents this was built against, not the exception: they
  hand-format their headings, so the tag tree has paragraphs where a reader
  expects sections. The combined reading recovers those where it can verify
  them against the page. What it cannot do is invent a level, so the outline is
  flat.
- **Ordinary content trapped inside a malformed table.** A parser that reads a
  page as one enormous table hides its text inside cells. Detecting that
  reliably needs a measurement nobody has made yet; detecting it *unreliably*
  would move real tables out of the document, which is worse.
- **Where the two readings disagree, the Reader offers a switch rather than a
  report.** A reader has to try both to find out what differs. Saying what
  differs — "the tagged reading has three headings this one does not" — is
  strictly more useful and strictly harder.
- **Nothing is said while the PDF is being analysed**, beyond that it is
  happening. The parser runs synchronously inside its worker and reports no
  progress, so a long document is one announcement and then silence until it is
  done. Splitting the run into stages it could report would be a change to the
  pipeline, not to the wording.
- **Image descriptions and OCR are Chrome's, and there is no Firefox version of
  them.** Firefox has on-device inference — the runtime behind its own PDF
  alt-text feature — but on Release it sits behind two `about:config` flags, its
  extension API promises no compatibility between versions, its captioning model
  writes English only, and it offers no OCR at all. An accessibility feature
  that needs `about:config` is a feature for people who do not need this
  extension. So on Firefox those panels leave themselves out and say why, and
  everything that does not need a model works the same on both.
- **Descriptions are one model's guess, in one prompt.** The prompt has not been
  iterated against real figures, and the on-device model's ceiling for dense
  Japanese has not been measured.
- **OCR is Chrome's general-purpose model**, not an OCR engine. It is labelled
  experimental because that is what it is. Whether a bundled engine (Tesseract
  and its ~15 MB of Japanese data) is worth the size is a decision that wants
  evidence from real use — and it is the only route that would ever give
  Firefox OCR as well.
- **The model download is measured in gigabytes** and the first description a
  reader asks for pays for it. The settings panel offers to get it out of the
  way; nothing else can.
- **The Japanese typeface is offered, not bundled.** Atkinson Hyperlegible now
  ships with the extension, so that choice always works. BIZ UDPGothic does not:
  a Japanese face is several megabytes, and the alternative — subsetting — drops
  characters a document might contain, which fails silently and in the one
  script this project exists for. So it stays a control that does nothing for a
  reader who has not installed it.

## What would change this file

Anything a reader reports. A document this extension reads badly is worth more
than any of the items above, because every one of those was written by guessing
at what would matter.
