# Architecture

The organising idea is a single **Document Model** in the middle. Every producer
lowers its own output into it through an adapter, and the Reader renders only
that model. No pdf-inspector type, PDF.js type or OCR provider type ever reaches
the UI.

That is what makes the roadmap tractable: Tagged PDF support, real image
extraction, hosted OCR and replacing the browser's PDF viewer are each a new
adapter or a new entrypoint, not a rewrite.

## Current pipeline

```
                          Action click (background.ts)
                                    │
                                    ▼
                              PdfSource
                    (UrlPdfSource / HandoffPdfSource)
                                    │
                              PDF bytes
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
             pdf-inspector                       PDF.js
           (WASM, Web Worker)          ┌────────────┼────────────┐
                    │                  ▼            ▼            ▼
          text / layout analysis   metadata /   structure    page rendering
                    │              MarkInfo     tree             │
                    ▼                  │            │      OCR page images
            InspectorAdapter           │            ▼            │
                    │                  │    TaggedPdfAdapter     ▼
                    │                  │            │      OcrProvider
                    │                  │            │            │
                    │                  │            │            ▼
                    │                  │            │       OcrAdapter
                    └────────┬─────────┴────────────┴────────────┘
                             ▼
                      Document Model
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
      Accessible Reader   Original      Markdown
       (semantic HTML)   (canvas)      (raw text)
```

### Choosing a structure producer

Both structure producers run on every document:

- **pdf-inspector** always runs, **entirely in a worker** — including lowering
  its Markdown into the Document Model, which is itself tens of milliseconds
  (58 ms on a 29-page deck) and grows with the document. The worker returns a
  Document Model, not a raw result. It produces the Markdown view, the OCR
  classification, and the structure used for untagged documents.
- **TaggedPdfAdapter** runs when `getMarkInfo()` reports `Marked: true`. If the
  extraction is usable, it wins.

Tagged structure wins because inference is a guess and tagging is a statement.
The difference is not academic — on the news-release fixture the tags recover a
table with column *and* row headers, and the numbered sections as a properly
numbered list, neither of which inference produced. `structureSource` records
the choice, and the Reader surfaces it in the document information panel so a
reader knows how much to trust what they are navigating.

### Text PDF

```
PDF → pdf-inspector → Document Model → Accessible Reader
```

### PDF that needs OCR

```
PDF → PDF.js → page image → OcrProvider → OcrAdapter → Document Model → Accessible Reader
```

## Layers

### 1. Launch — `entrypoints/background.ts`

The only code that knows the Reader is started by a toolbar click or a
context-menu item. It reads the active tab's URL, fetches the PDF while the
`activeTab` grant is live, parks the bytes, and opens the Reader tab.

There is a third way in that this file has no part in: with the **Opening PDFs**
setting on, the browser itself rewrites the navigation, and the Reader reads the
address out of its own URL. No code of ours runs at navigation time.

### 2. Acquisition — `lib/pdf/source/`

```ts
interface PdfSource {
  readonly id: string;
  getBytes(): Promise<ArrayBuffer>;
  getOriginalUrl(): string | null;
}
```

| Implementation | Status | Used for |
| --- | --- | --- |
| `HandoffPdfSource` | shipped | Bytes the background worker already fetched. Primary path. |
| `UrlPdfSource` | shipped | Direct fetch; same-origin and CORS-enabled URLs. Fallback. |
| `BytesPdfSource` | shipped | In-memory bytes (tests, future file picker). |
| `MimeHandlerPdfSource` | planned | Chrome `application/pdf` MIME handler stream. |
| `FilePdfSource` | planned | File picker / drag and drop. |
| `BlobPdfSource` | planned | `blob:` URLs, once reachable. |

**Why the handoff exists.** `activeTab` grants a temporary host permission to
the *background worker*, not to the Reader tab, so the fetch must happen at
click time.

**And where it does not work.** That sentence is Chrome's. Firefox implements
`activeTab` as script injection plus the privileged parts of the `tabs` API and
**not** as host access for a fetch, so the background's `fetch` there is an
ordinary cross-origin request and comes back `TypeError: NetworkError`
(measured, 2026-09-22). The Reader then falls back to `UrlPdfSource` and is
refused by CORS. Nothing recovers this from the inside: the answer is
`lib/browser/site-access.ts`, which asks the reader for that one site. Extension messages are JSON-serialised, which would force a
multi-megabyte PDF through base64, and MV3 service workers cannot create blob
URLs. The Cache API is available in both contexts and stores a `Response`
verbatim, so the background puts the response in and the Reader takes it out and
deletes it (`lib/browser/handoff.ts`).

### 3. Analysis — `lib/pdf/inspector/`

`@firecrawl/pdf-inspector-wasm` runs in a dedicated module worker. Its
`processPdf` is synchronous once initialised and can take seconds, so running it
on the Reader's thread would freeze the UI — including the live region that
announces progress.

- `worker.ts` — the worker. Imports the WASM with `?url` so the bundler emits it
  once and its final path is explicit.
- `protocol.ts` — the messages, plus TypeScript mirrors of pdf-inspector 0.1.3's
  result types.
- `client.ts` — main-thread handle; owns the worker, correlates requests,
  supports cancellation. Contains no extension API.
- `markdown-to-document.ts` — Markdown → Document Model, via mdast.
- `adapter.ts` — the pdf-inspector result → Document Model + `PdfCapabilities`.
- `headings.ts` — takes back headings that are measurably not sections. Runs in
  the worker as part of the adapter; every rule only demotes.
- `heading-promotion.ts` — the one promotion. pdf-inspector merges a
  hand-formatted heading (「１. 背景および目的」) into the paragraph under it;
  this splits the block where PDF.js's line ends, when the line has the shape
  of a section head. Runs on the main thread, after both producers, because it
  needs PDF.js — see `lib/pdf/text-alignment.ts` for the matching itself.

**Manifest V3 constraints.** An extension page needs `'wasm-unsafe-eval'` in
`content_security_policy.extension_pages` before it may instantiate *any*
WebAssembly. It is a narrow allowance and is **not** `'unsafe-eval'` — no
JavaScript `eval` is permitted, and none is used.

Both targets are V3 and both need it. Under V2 Firefox did not: it allowed
WebAssembly without the keyword and rejected manifests that carried it, so the
key was emitted for Chromium only. Moving Firefox to V3 turned that exception
into `call to WebAssembly.instantiateStreaming() blocked by CSP` on every
document (measured 2026-09-22), which is what an analysis failure looks like
from the outside. No other CSP relaxation exists.

**Page attribution.** `includePageMarkers: true` makes pdf-inspector emit
`<!-- Page N -->` comments. Those markers are the only way to attribute Markdown
blocks back to PDF pages, and per-page attribution is what makes mixed documents
assemblable. They are the *only* HTML the Markdown converter interprets;
everything else is dropped, so no PDF-derived string is ever treated as markup.

### 3.5. Aligning two producers' text — `lib/pdf/text-alignment.ts`

Producer-neutral, and deliberately outside both `inspector/` and `pdfjs/`.
Given a block of text as one producer returned it and the lines of the same
page as another did, it finds the line boundaries inside the block. The only
tolerance is whitespace, because whitespace is the only thing the producers
were measured to differ in; a block that does not match exactly is reported as
not found, never approximated — the one measured non-match is text
pdf-inspector dropped, which is the kind of divergence a future gap report
exist to report. Heading promotion is its first consumer.

### 3.6. The combined reading — `lib/pdf/combined-reading.ts`

The tagged reading with the headings it lacks. Offered — and opened by default
— only for a tagged document whose tags carry no headings, and only when an
inferred heading's text is found as a whole top-level tagged node or the start
of one; that node becomes a heading, or is split into a heading and its
paragraph. The words are the tagged reading's; the claim is inference's, and
says so on the node (`origin`). Anything inside a list, table or figure, and any
document with a heading tag of its own, is left exactly as the author tagged it.

### 4. Document Model — `lib/pdf/document-model.ts`

```ts
interface AccessibleDocument {
  metadata: DocumentMetadata;
  pages: DocumentPage[];
}

interface DocumentPage {
  pageNumber: number;
  origin: DocumentOrigin;   // 'pdf-inspector' | 'ocr' | 'tagged-pdf' | 'pdf-text'
  status: PageStatus;       // 'available' | 'requires-ocr' | 'empty'
  nodes: DocumentNode[];
}

type DocumentNode =
  | HeadingNode | ParagraphNode | ListNode | TableNode
  | FigureNode  | BlockquoteNode | CodeNode | ThematicBreakNode | UnknownNode;
```

`origin` is per page, not per document. That is the mixed-PDF seam:
`mergeOcrPages()` (in `lib/pdf/ocr/merge.ts`) folds an OCR document into an
inspector one, and an empty OCR page can never erase text the inspector already
found. There is exactly one merge function on purpose — a second, more
permissive one lived here for a while, and two functions answering the same
question by different rules is the shape of defect this project keeps finding.

**Provenance is per page and, when it differs, per node.** `DocumentPage.origin`
says which producer read the page; `NodeProvenance.origin` on a block node is
set only when that node came from somewhere else — the combined reading's
headings are the case — and `nodeOrigin(node, page)` resolves it. A merge whose
provenance cannot be stated is not one this project ships, and this is the
field that lets it be stated. `DocumentOrigin` also carries `combined`, which
names a *reading* of the whole document and is never written on a page or node.

**One deliberate deviation from the brief.** `LinkNode` is modelled as an
*inline* node rather than a member of the block-level `DocumentNode` union. An
`<a>` lives inside a paragraph, a heading or a table cell; a block-level link
node could not be rendered as valid, navigable HTML. `FigureNode` is where the
brief describes it, with `status` of `available` / `missing-alt` / `unavailable`.

### 5. Rendering — `lib/reader/renderer.tsx`

The Document Model becomes React elements — `<h2>`, `<p>`, `<ul>`, `<table>`
with `<th scope>`, `<a>`, `<figure>`. Two rules:

- **No `dangerouslySetInnerHTML`.** Every node becomes an element, so no string
  from the PDF is ever interpreted as markup.
- **Native semantics first.** There is no ARIA in the renderer at all, because
  HTML already expresses everything the model contains.

The ARIA in the project is all in the chrome around the document, and all of it
is for something HTML has no element for:

- **`role="toolbar"`** on the actions, with arrow-key movement and deliberately
  *without* the roving tabindex the APG pairs with it — that trade buys fewer
  Tab stops and sells controls Tab cannot reach.
- **`role="status"`** for every operation that takes longer than an instant:
  the analysis, an OCR run, a figure being described, the model download, a
  structure switch. Each region is **in the page from the first render** with an
  empty string in it, because a live region created together with its first
  message is frequently announced by nothing. `.apv-status` and its siblings
  reserve height rather than `display: none` for the same reason — a region
  that is not in the accessibility tree at the moment its text arrives is a
  region nobody hears.
- **`role="alert"`** for failures, which is the opposite case: those are
  mounted when they happen, because an alert announces on insertion.
- **`aria-disabled`, never `disabled`, on a control that starts long work.** A
  disabled element cannot hold focus, so `disabled` throws focus to the top of
  the document at the moment the user presses the thing they meant to press.
  The handler refuses the second press instead.

The Reader owns the page's `<h1>` (the document title), so content headings are
shifted down one level and clamped at `<h6>`. A body heading that merely repeats
the title is dropped rather than read twice.

Link targets pass through `lib/pdf/sanitize-url.ts` first: a PDF is untrusted
input, and only `http`, `https`, `mailto`, `tel` and `ftp` reach an `href`.
Anything else degrades to plain text with its text intact.

So does the toolbar's link to the original PDF, which is a newer hazard: the
Reader is a web-accessible resource — the redirect that opens it has to be
allowed to land somewhere — so any page can open it with an address of its
choosing, and that address becomes an `href` in a document running with the
extension's own origin.

### 5b. Markdown out — `lib/reader/markdown-serializer.ts`

The Markdown view showed pdf-inspector's output verbatim, which stopped being
the right answer once other producers existed: a tagged PDF's Markdown
described a *worse* reading of the document than the one on screen, and
generated figure descriptions did not appear in it at all.

`documentToMarkdown()` serialises the Document Model, so the view can offer the
rendered document alongside the raw parser output. The provenance rule extends
here: a generated description is written with the same "generated by AI"
prefix it is read with — in whichever language the reader was reading, because
Markdown is the artefact that leaves the
extension.

GFM is lossy against the model — no row headers, and a header row is mandatory
— which is precisely why the Reader is the accessible output and this is a
convenience.

### 6. OCR — `lib/pdf/ocr/`

```ts
interface OcrProvider {
  readonly id: string;
  readonly sendsDataExternally: boolean;
  readonly experimental: boolean;
  isAvailable(): Promise<boolean>;
  analyze(input: OcrInput, options?: OcrOptions): Promise<OcrResult>;
}

type OcrBlock =
  | OcrHeading | OcrParagraph | OcrList | OcrTable | OcrFigure | OcrUnknown;
```

`OcrResult` is structured, never `plainText: string`. A provider that can report
headings, tables and reading order should be able to, and the model must not
discard it; `OcrUnknown` lets a text-only engine remain a first-class provider
without pretending to know more than it does.

`sendsDataExternally` is on the interface rather than in a comment so the Reader
can enforce consent for *any* such provider without knowing which one it is
(`runOcrForPages` refuses to run without it). No bundled provider sets it.

Rasterisation is per page (`lib/pdf/pdfjs/page-image.ts`). Handing a whole PDF
to a provider would send pages that already have perfectly good text — wasteful
on a local engine, expensive on a hosted one, and more of the user's document
transmitted than the job requires.

That per-page shape is what the Reader's OCR panel exposes: `runOcrForPages`
takes a page list, so "read page 7" and "read all 27" are the same call. On a
long scanned deck the per-page button is usually the one that matters — a page
is seconds of on-device work, and the reader rarely needs all of them.

A run of any length arrives **one page at a time**: rasterise a page, read it,
hand it to the caller through `onPageResolved`, then start the next. Rendering
the whole list up front and returning once at the end produced the same
document and showed the reader none of it until the last page came back — on a
29-page scan, minutes of unchanged screen, every page image alive at once, and
nothing kept if the run failed or was stopped half way. The panel merges each
page as it lands, so the document fills in as it is read and a stopped run
keeps what it read. Same lesson as `onFigureResolved` in the describer.

`merge.ts` folds the result back into the document already on screen, which by
then may carry figure descriptions the user waited for. Four rules, each
guarding a false claim:

1. A page OCR could not read is **left as it was**. An empty result means OCR
   failed, not that the page is blank.
2. A page that already had text is never overwritten — the document's own words
   beat a machine's reading of a picture of them.
3. A figure the producer **located** survives the page being replaced. It used
   to be deleted with the rest of the page's nodes, so a page holding a picture
   and no text lost the picture — and any description generated for it — by
   being read. Recognised text carries no coordinates, so there is nowhere to
   put such figures back: they go to the end of the page, `carriedFigures`
   records how many, and the Reader says on that page that the order is not the
   document's.
4. `producedBy` gains `ocr`, so the document reports itself as a mix.

Every OCR-read page is labelled at the point of reading, exactly like a
generated figure description and for the same reason.

### 6.5. Interface language — `lib/i18n/`

```ts
export const en = { … };            // the catalogue *and* the type
export const ja: Messages = { … };  // must satisfy it, or it does not compile
```

`Messages` is `typeof en` with its string literals widened and its function
signatures kept. That is the whole mechanism, and it buys the one property a
translation library does not: **a missing message is a compile error**, not a
silent fallback to English inside a Japanese sentence. The messages that say
where a piece of text came from — "description generated by AI",
「AIによる自動生成の説明」 and their siblings —
are load-bearing accessibility text, and a half-translated one is a claim in a
language the reader may not read.

Not `browser.i18n`: it resolves against the browser's UI language and cannot be
switched at runtime (wxt-dev/wxt#2481, closed as not-possible-by-design). Not
`i18next`: measured, the Reader chunk sits at 499.9 kB against Vite's 500 kB
warning ceiling, and `i18next` plus `react-i18next` is another ~60 kB of
runtime for two locales, one plural rule and no ICU.

The split that remains is deliberate:

| Strings | Mechanism | Follows |
| --- | --- | --- |
| Manifest name, description, action title, context menu | `public/_locales/` + `default_locale: 'en'` | the browser |
| Reader and side-panel interface | this catalogue | the reader's own setting |
| Diagnostics — a model's raw reply, a failure reason | English literals | nothing; they are evidence |

**Four languages meet here, not three.** The interface's, the document's, the
one generated text is written in (`chooseOutputLanguage`), and — since the
`aiLanguage` setting — the reader's own override of the third. That setting
exists for the one case no amount of parsing can detect: a document that
declares a language and declares the wrong one. Nothing in the file betrays it,
because the file is the part that is wrong, so the only thing that can overrule
it is a person. `preferredAiLanguage` resolves the setting to a language and
both panels pass it to the same chooser, so the probe, the session and the
sentence that says which language will be used cannot disagree.

**Names are translated too.** The three views are katakana in Japanese —
リーダー, オリジナル, マークダウン — because a screen reader meeting a bare
`Reader` inside a Japanese sentence either switches voice for one word or
mispronounces it. Every message that points at a view uses the same word, and
the panels' own `aria-label`s come from the catalogue rather than the markup for
the same reason.

Errors carry a `messageKey` as well as a `code`, because three different
situations share `unsupported-scheme` and a reader told only that has been told
nothing actionable. `Error.message` is the English sentence, taken from the
same catalogue entry, so a console line and the panel cannot disagree.

### 7. PDF.js — `lib/pdf/pdfjs/`

Present from day one because it is the only thing that can show a scanned
document at all. It now does several jobs, one module each:

- `renderer.ts` — Original view rendering.
- `page-image.ts` — per-page images for OCR.
- `page-drawing.ts` — walks a page's operator list to find what it paints and
  where, attributed both by draw order and by marked-content id.
- `figure-regions.ts` — decides which region belongs to which figure.
- `region-raster.ts` — renders a region to a blob, for the Reader and for the
  describer.
- `metadata.ts` — `getMetadata()` and `getMarkInfo()`. Source of the document's
  title, author, dates, `/Lang` and its tagged-or-not status. PDF.js types
  `info` as `Object`, so every field is validated rather than trusted.
- `tagged-adapter.ts` + `page-text-index.ts` — the structure tree.
- `page-lines.ts` — a page's text as lines with positions, rebuilt from
  baselines. `hasEOL` is not used: measured on the fixtures it is set before
  some lines, on the last run of others, and not at all elsewhere.
- `page-content.ts` — why a page yielded no text: raster images (`image`), paths
  only (`vector`, i.e. text converted to outlines), or neither (`blank`). One
  sentence of wording depends on it, and the sentence it replaced — "this page
  is displayed as an image" — was false for every outlined deck.
- `language.ts` — `/Lang`, then Chrome's detector, then the writing system.
  Kana means Japanese and hangul means Korean; Han characters alone are
  deliberately not claimed, because they are shared across CJK and a wrong
  `lang` commits a screen reader to the wrong pronunciation for the whole
  document.

**How tagged text is recovered.** A structure tree contains no text. Its leaves
reference marked-content sections in the page's content stream, and the text
only appears if `getTextContent({ includeMarkedContent: true })` is asked for
the section boundaries. `page-text-index.ts` builds that join, collecting a
bounding box per section at the same time — which is also how a `Link` element,
which carries no destination of its own, is matched to the page's link
annotation.

One consequence worth knowing: a tagged PDF puts each glyph run in its own
marked-content section, so text arrives as `"2"`, `"0"`, `"2"`, `"6"`, `" 年"`.
Spacing repair therefore runs *after* the fragments are joined, not per
fragment.

All runtime assets (worker, CMaps, standard fonts, JBIG2/JPEG2000/colour WASM)
are vendored into `public/pdfjs/` by `scripts/copy-assets.mjs` and served from
the extension origin. CMaps in particular are not optional: Japanese documents
render as blanks without them.

## Where future work attaches

### Comparing real and inferred structure

Tagged PDF support is implemented, so both structures are now computed for every
tagged document. Diffing them — "PDF tag: P, inferred: H1" — is what the planned
Structure view would show. Nothing new is needed to produce the inputs; only the
comparison and its presentation.

Roles not yet mapped by `TaggedPdfAdapter`: `Ruby`/`RT` (Japanese phonetic
annotations, which have a native HTML equivalent in `<ruby>`), `Note`/`Reference`
footnote relationships, and `Artifact` exclusion beyond what marked content
already gives. `THead` spanning multiple header rows collapses to one header row
plus `<th>` cells in the body, because the Document Model carries a single
header row.

### Hosted OCR

```
HostedOcrProvider           ← new file in lib/pdf/ocr/, registered in registry.ts
        ↓
  OcrAdapter                ← unchanged
        ↓
  Document Model            ← unchanged
```

Setting `sendsDataExternally: true` is enough to make the Reader demand consent.
Authentication, billing, subscriptions and the backend are out of scope for this
codebase.

### Figures, images, and descriptions — `lib/pdf/pdfjs/`, `lib/pdf/describe/`

Neither structure producer reports where a figure sits, so the position is
recovered from the page content stream: `findPageDrawing()` walks the operator
list, tracks the graphics state, and records what each drawing operation covers.

Four steps, four modules, because they change for different reasons:
`geometry.ts` (rectangles and matrices — pure, and where every mis-placement
this project has had originated), `page-drawing.ts` (what the page paints),
`figure-regions.ts` (which region is which figure), `region-raster.ts` (region
to pixels).

**Two ways to attribute what it finds**, and the difference matters:

- **Tagged PDFs — exact.** The tag tree names the marked-content sections a
  figure covers, and the walker attributes every painted operation to the
  section it sits in. The figure's region is the union of its own sections. No
  order matching, and it works for a figure drawn with **vector paths**, which
  paints no image operator at all — one prospectus in the fixtures has a scheme
  diagram that nothing image-based could ever have found.
- **Untagged PDFs — heuristic.** Images are matched to figures by draw order,
  with nearby ones merged when a page paints more images than it declares
  figures.

The exact path also fixes what the heuristic got wrong: two photographs side by
side were merged into one region and described as a single composite picture,
and a full-width masthead — tagged `Artifact`, i.e. page furniture the author
excluded from the structure — was matched to a figure it had nothing to do
with.

That single addition unlocks the rest:

```
operator list ──▶ PageImageRegion ──▶ FigureNode.source = {kind:'pdf-page-region'}
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                   ▼
        materializeFigureImages()              describeFigures()
        renders each region to a blob          crops each region and sends it
        URL, so Reader mode shows the          to a FigureDescriber
        actual picture
```

`FigureNode.contentIds` carries the marked-content identifiers the tags
supplied, which is what makes the exact path possible; figures without them
fall back to draw order.

**`FigureDescriber` is deliberately not an `OcrProvider`.** OCR misreads
something that exists; a description invents something that does not. Different
truth status means different labelling, so they are different interfaces.

**The provenance invariant.** `FigureNode.alternativeTextSource` records who
wrote the text — `'author'`, `'ocr'`, `'generated'`, or `'document-ai'` — and
`run-describe.ts`
can only ever write a description together with `'generated'`. The renderer
turns that into what a screen reader actually says: "Image:" for the author's
words, "Image (description generated by AI):" for a model's — 「画像:」 and
「画像（AIによる自動生成の説明）:」 in Japanese. A reader who cannot
see the picture cannot check a description against it, so this label is the
entire safeguard, and it is covered by tests rather than convention.

`'document-ai'` is the subtle one. A Tagged PDF's `/Alt` was treated as the
author's own words until a real document showed otherwise: Word generates
alternative text and writes it into `/Alt` verbatim, disclaimer included
(「AI 生成コンテンツは誤りを含む可能性があります。」). So a `/Alt` proves the
field is populated, not that a person described the image. `generated-alt.ts`
detects the vendor boilerplate — only the exact known strings, because wrongly
demoting a human's text is the worse error — strips it, and marks the figure
`'document-ai'`. That value is the only existing alternative text
`needsDescription()` will offer to replace: nobody vouched for it, and it is
typically a shape inventory rather than a description.

`ChromeAiFigureDescriber` uses Chrome's built-in model, on device, so
`sendsDataExternally` is false and no consent gate applies — a hosted describer
would set it true and `describeFigures()` refuses to run without consent, the
same rule `OcrProvider` follows. One constraint shapes the code: **the Prompt
API is unavailable in Web Workers**, so unlike every other expensive path in
this project it runs on the Reader's thread, one figure at a time, yielding
between them so the live region keeps announcing progress.

### Talking to Chrome's model — `lib/ai/chrome-session.ts`

Session lifetime — feature detection, `availability()`, `create()`,
clone-per-item, disposal — is shared by the describer and the OCR provider, and
lives in one class that knows nothing about figures or pages.

It is shared because it was **the same bug twice**: omitting `expectedOutputs`,
which makes Chrome refuse to attest to output safety and log *"No output
language was specified in a LanguageModel API request"*. First on `create()`,
then again on `availability()` — the probe has to describe the very session it
is probing for. Two call sites meant two chances to forget; one call site means
none. `ChromeAiSession#describe()` builds that options object once, and both
calls take it.

Which language to ask for is a separate decision, in
`describe/output-language.ts`: the document's own `/Lang` if it has one,
otherwise the browser's language, and English only as a last resort. That
fallback is a guess about the *reader*, so the panel says which language it
chose and why.

### Replacing the browser's PDF viewer

Two routes. One of them exists.

**The redirect** is what the *Opening PDFs* setting turns on, and it ships:
`lib/browser/pdf-handler.ts` registers a single `declarativeNetRequest` rule
that rewrites a top-level navigation to a `.pdf` address into the Reader, with
the address carried in the fragment because a rule's substitution cannot encode
anything. It buys that with an optional host permission — the file says why
nothing smaller works — and it can only recognise a PDF *by its address*,
because the decision has to be made before any response exists.

**The MIME handler** is the route that needs neither compromise:

```
application/pdf MIME handler   ← new entrypoint
        ↓
  MimeHandlerPdfSource         ← new PdfSource
        ↓
  same parser, OCR, Document Model, Reader
```

It would catch a PDF served from `/download?id=42`, which the rule cannot, and
it would need no host permission at all. Launch is already separated from the
Reader for it: `background.ts` is the only file that knows about the toolbar
click, and the Reader takes a `PdfSource` and nothing else. `mime_types_handler`
is deliberately not implemented in this version.

### A Structure view

The fourth mode — `[Reader] [Original] [Markdown] [Structure]` — would show
actual Tagged PDF structure, inferred structure and OCR-derived structure side
by side. `DocumentPage.origin` already records which producer supplied each page.
