/**
 * The Reader's interface, in English, and the shape every other locale takes.
 *
 * This file is the type. `ja.ts` is declared as `Messages` and so cannot omit a
 * key, cannot add one, and cannot change what a message's parameters are — a
 * translation that has fallen behind the interface is a compile error rather
 * than an English sentence appearing inside a Japanese one at runtime. See
 * `index.ts` for why that mattered enough to hand-roll.
 *
 * Rules for writing a message here:
 *
 *   - **Say what is true, not what is reassuring.** These strings are the whole
 *     of what the Reader claims about a document, and most of those claims
 *     cannot be checked by looking at the page. "We could not read this" and
 *     "there is nothing here" are different sentences and must stay different.
 *   - **Name the machine.** Anything a model produced says so where it is read,
 *     every time, in every locale.
 *   - **A count comes with its noun.** English needs the plural; Japanese does
 *     not have one. That is why the messages that count are functions rather
 *     than strings with a number glued on afterwards.
 *   - `**emphasis**` is the only markup, rendered by `rich()`.
 */
export const en = {
  app: {
    /**
     * The BCP-47 tag for this catalogue, for `Intl` and for `lang`.
     *
     * In the catalogue rather than beside it so the two cannot disagree: a
     * date formatted in one language inside an interface written in another
     * is the kind of mismatch nobody notices until a screen reader reads it
     * out in the wrong voice.
     */
    locale: 'en',
    /** The extension's own name. Not translated: it is what the store lists. */
    name: 'Accessible PDF View',
    skipToContent: 'Skip to content',
    /** The document, and a note about it, for the tab title — which view it is
     * being read in, or what is still happening to it. In the catalogue
     * because it is punctuation, and punctuation is not the same in both
     * languages. */
    documentNote: (name: string, note: string) => `${name} (${note})`,
    openInNewTab: '(opens in a new tab)',
    openInSidePanel: '(opens in the side panel)',
    footerPrivacy:
      'This extension analyses PDFs inside your browser. An ordinary PDF is never sent to an external server.',
  },

  /**
   * The same states as `status`, shortened for a browser tab.
   *
   * Separate strings rather than the sentences below, because a tab title is
   * not a sentence: "Analysing the PDF. — Accessible PDF View" carries a full
   * stop into the middle of a title. These end in an ellipsis instead, which is
   * what a title uses to mean "still going".
   */
  tabTitle: {
    fetching: 'Fetching…',
    analyzing: 'Analysing…',
    failed: 'Could not be read',
  },

  status: {
    fetching: 'Fetching the PDF.',
    analyzing: 'Analysing the PDF.',
    loadFailed: 'The PDF could not be loaded.',
    ready: (pageCount: number) =>
      `Finished analysing the PDF. ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}.`,
    readyNeedsOcr: (pageCount: number) =>
      `Finished analysing the PDF. ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}. ` +
      'Some pages contain no readable text. OCR is needed.',
  },

  views: {
    selectLabel: 'View',
    reader: { label: 'Reader', description: 'Structured, readable HTML' },
    original: { label: 'Original', description: 'The original PDF pages as they look' },
    markdown: { label: 'Markdown', description: 'The analysis as Markdown' },
    /* The name each view's region is announced by when a reader moves into it.
     * From the catalogue rather than written into the markup, because a view's
     * name is not the same word in every language — see `ja.ts`. Original says
     * more than its name, because its name alone does not distinguish it from
     * the document the Reader is showing. */
    readerPanelLabel: 'Reader',
    originalPanelLabel: 'Original — the original PDF pages as they look',
    markdownPanelLabel: 'Markdown',
  },

  toolbar: {
    documentActions: 'Actions for this document',
    print: 'Print',
    originalPdf: 'Original PDF',
    /* Replaces the "(opens in a new tab)" note on that link while the PDF
     * handler is on, rather than sitting beside it: two parenthetical asides
     * on one link are read out as two, and this one has to carry both facts. */
    originalOpensHere:
      '(opens in a new tab — and in this Reader, because of your “Opening PDFs” setting)',
    settings: 'Settings',
    settingsFailed: (detail: string) => `Settings could not be opened. ${detail}`,
  },

  structure: {
    /**
     * Three surfaces name these readings: the picker above the document, the
     * same picker over the Markdown view, and the setting that decides which
     * one a document opens with. A reader who sets a default called one thing
     * and then meets a control calling it another has been handed two facts to
     * reconcile for no reason.
     */
    legend: 'How the structure was read',
    sources: {
      combined: {
        label: 'Structure tags + inferred headings',
        detail:
          "The author's own structure, with headings inferred from where the text sits. Offered only for a PDF whose tags carry no headings. Everything but the headings is the tags as the author left them.",
      },
      'tagged-pdf': {
        label: "The PDF's structure tags",
        detail:
          'The structure the author marked up: heading levels, table structure, and any alternative text they wrote.',
      },
      'pdf-inspector': {
        label: 'Inferred from the layout',
        detail:
          'Structure guessed from where the text sits. Alternative text the author wrote cannot be reached this way, and headers and footers may run into the body.',
      },
      ocr: { label: 'What OCR recognised', detail: 'Text read off the image.' },
      'pdf-text': {
        label: 'Extracted text only',
        detail: 'The text alone, from pages whose structure could not be read.',
      },
    },
    headingCount: (count: number) => `${count} ${count === 1 ? 'heading' : 'headings'}.`,
    reloading: (label: string) => `Re-reading as “${label}”.`,
    reloadFailed: (detail: string) => `Could not re-read. ${detail}`,
    staysWithReading:
      'Generated descriptions and OCR results stay with the reading they were applied to. Switching to the other one hides them; switching back finds them again.',
  },

  documentInfo: {
    summary: 'Document information',
    author: 'Author',
    subject: 'Subject',
    keywords: 'Keywords',
    language: 'Language',
    pageCount: 'Pages',
    created: 'Created',
    modified: 'Modified',
    creator: 'Created with',
    producer: 'PDF produced by',
    pdfVersion: 'PDF version',
    tagged: 'Structure tags',
    taggedYes: 'Yes (Tagged PDF)',
    taggedNo: 'No',
    thisView: 'Structure on screen',
    pages: (count: number) => `${count} ${count === 1 ? 'page' : 'pages'}`,
    structure: {
      combined: "From the PDF's structure tags, with headings inferred from the layout added",
      'tagged-pdf': "From the PDF's structure tags (the structure the author marked up)",
      'pdf-inspector': 'Inferred from the layout',
      ocr: 'Recognised by OCR',
    },
    untaggedNote:
      'This PDF carries no structure tags, so headings and tables are inferred from where the text sits. They may differ from the document’s real structure.',
    combinedNote:
      "This PDF's structure tags carry no headings. Every heading on screen was inferred from where the text sits; everything else is the structure the author marked up. Inferred headings may differ from the document's real structure.",
  },

  markdown: {
    legend: 'What the Markdown contains',
    sameAsReader: 'The same as the Reader',
    sameAsReaderDetail: (reading: string) =>
      `What the Reader is showing now, read as “${reading}”.`,
    sameAsReaderDetailPlain: 'What the Reader is showing.',
    generatedAreMarked:
      'Where it includes a generated image description, that description is marked as such.',
    rawOutput: "pdf-inspector's raw output",
    rawOutputDetail:
      'The Markdown the parser emitted, unchanged. A record of how the analyser read this PDF, which is not always what the Reader shows.',
    copy: 'Copy the Markdown',
    copied: 'Markdown copied.',
    copyFailed: 'Could not copy. Select the text and copy it yourself.',
    emptyNoText:
      'No Markdown was produced from this PDF. That happens when every page is made of pages with no text. The Original view can still show you the pages.',
    empty: 'There is nothing to show.',
  },

  original: {
    pageHeading: (pageNumber: number) => `Page ${pageNumber}`,
    pageImageOnly: (pageNumber: number) =>
      `Page ${pageNumber}. This page is shown as an image. No text can be obtained from it at the moment.`,
    pageNormal: (pageNumber: number) =>
      `Page ${pageNumber}. Showing the original PDF page as it looks. The text is readable in the Reader view.`,
    rendering: 'Drawing this page…',
  },

  figures: {
    /**
     * Where a description came from, said every time it is read.
     *
     * Not decoration and not a disclaimer: whether a sentence about a picture
     * was written by the author, generated by a model, read off the image by
     * OCR, or produced by the word processor is the one thing a reader cannot
     * establish from the sentence itself.
     */
    withGeneratedAlt: (text: string) => `Image (description generated by AI): ${text}`,
    withOcrText: (text: string) => `Image (text read from inside the image): ${text}`,
    withDocumentAiAlt: (text: string) =>
      `Image (description generated by the word processor): ${text}`,
    withAlt: (text: string) => `Image: ${text}`,
    decorative: 'A decorative image. It carries no content.',
    decorativeGuess:
      'There is an image here. An AI judged it decorative; that judgement is automatic and may be wrong.',
    unavailable: 'There is an image here, but it could not be shown.',
    describeFailed:
      'There is an image here. Its content was analysed, but no description could be generated.',
    noAlt: 'There is an image here. No alternative text could be obtained.',
    table: 'Table',
    tableWithCaption: (caption: string) => `Table: ${caption}`,
    pageLabel: (pageNumber: number) => `Page ${pageNumber}`,
  },

  notices: {
    retry: 'Load it again',
    ocrRequired: {
      title: 'OCR is needed',
      wholeDocument: 'This PDF contains no readable text.',
      onePage: (pageNumber: number) =>
        `Page ${pageNumber} of this PDF contains no readable text.`,
      pages: (pageList: string) =>
        `These pages of this PDF contain no readable text: ${pageList}.`,
      mayHelp: 'Running OCR (text recognition) may make it readable.',
      originalHint: 'The Original view can show you the pages as they look.',
      encodingIssue:
        'This PDF also has a character-encoding problem. The extracted text may not read correctly.',
    },
    pageLabel: (pageNumber: number) => `Page ${pageNumber}: `,
    ocrPage:
      'The text on this page was read by OCR (machine text recognition). It may contain mistakes.',
    carriedFigures: (count: number) =>
      `The ${count} ${count === 1 ? 'image' : 'images'} on this page ${count === 1 ? 'has' : 'have'} been collected after the text. Recognised text carries no position information, so where they sat on the original page is not reflected here.`,
    recoveredPage:
      'The analyser could not read this page, so only its text is shown. Headings, tables and other structure have been lost.',
    noHeadings: (otherLabel: string, otherCount: number) =>
      `The reading on screen has no headings, so heading navigation cannot move through it. Switching to “${otherLabel}” gives you ${otherCount} ${otherCount === 1 ? 'heading' : 'headings'}.`,
  },

  pageContent: {
    garbled:
      'The text on this page cannot be read correctly, because its font information is broken. The characters are there, but they cannot be extracted as meaningful text. Running OCR (text recognition) may make it readable.',
    image:
      'This page is stored as an image, so its content cannot be extracted as text. Running OCR (text recognition) may make it readable.',
    vector:
      'The text on this page is drawn as shapes (outlines), so it cannot be extracted as text. There is no image on it either. Running OCR (text recognition) may make it readable.',
    blank: 'No readable content was found on this page.',
    unknown:
      'No text could be obtained from this page. Running OCR (text recognition) may make it readable.',
  },

  ocrPanel: {
    heading: 'OCR (text recognition)',
    unavailable: (pageCount: number) =>
      `${pageCount} ${pageCount === 1 ? 'page has' : 'pages have'} no text that can be obtained. OCR cannot be run on this device.`,
    unavailableWhy:
      "This extension's OCR uses Chrome's built-in AI and runs on your device. It needs desktop Chrome, 22 GB of free storage, and 16 GB of memory or 4 GB of VRAM.",
    available: (pageCount: number) =>
      `${pageCount} ${pageCount === 1 ? 'page has' : 'pages have'} no text that can be obtained. Chrome's built-in AI can read the characters on your device.`,
    caveat: (language: string) =>
      `Text that OCR reads is a **machine's reading** and may contain mistakes. The Reader labels such a page as read by OCR. Everything happens on this device; no page image is sent anywhere. The page will be read as ${language}.`,
    languageFromSetting:
      'Your settings say to read pages in the interface language rather than the one the document declares.',
    howItRuns:
      'Pages are read one at a time, and each one reaches the document as soon as it has been read. Stopping part way keeps the pages already read.',
    readAll: (pageCount: number) =>
      `Read all ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`,
    reading: 'Reading…',
    perPageHeading: 'Read one page',
    readPage: (pageNumber: number) => `Read page ${pageNumber}`,
    stop: 'Stop reading',
    failed: (detail: string) => `OCR could not be run. ${detail}`,
    preparing: 'Preparing to read…',
    readingPage: (pageNumber: number) => `Reading page ${pageNumber}…`,
    readingPageOf: (pageNumber: number, total: number, index: number) =>
      `Reading page ${pageNumber}… (${index} of ${total})`,
    stoppedNothing: 'Reading stopped. No page was read.',
    stoppedAfter: (pages: string) => `${pages} read, then stopped.`,
    notRead: (count: number) =>
      `The remaining ${count} ${count === 1 ? 'page was' : 'pages were'} not read.`,
    nothingRead: (attempted: number) =>
      `${attempted} ${attempted === 1 ? 'page was' : 'pages were'} analysed, but no text could be read.`,
    read: (pages: string) => `${pages} read.`,
    couldNotRead: (count: number) =>
      `${count} ${count === 1 ? 'page' : 'pages'} could not be read.`,
    pageList: (pageNumbers: readonly number[]) =>
      `${pageNumbers.join(', ')} ${pageNumbers.length === 1 ? 'page' : 'pages'}`,
    pageCountOnly: (count: number) => `${count} ${count === 1 ? 'page' : 'pages'}`,
  },

  describePanel: {
    heading: 'Image descriptions',
    intro: (total: number) =>
      `This document has ${total} ${total === 1 ? 'image' : 'images'} with no alternative text from the author. Chrome's built-in AI can generate descriptions on your device.`,
    machineWritten: (machineWritten: number, missing: number) =>
      `${machineWritten} of them carry a description a word processor generated. That is not the author's own text, so they are included.` +
      (missing > 0 ? ` The other ${missing} have no alternative text at all.` : ''),
    caveat:
      'A generated description is **a guess made by a model**, not the author’s. It may be wrong. The Reader labels every one of them as generated by AI. Everything happens on this device; no image is sent anywhere.',
    languageIs: (language: string) => `Descriptions will be written in ${language}.`,
    languageFromDocument: (tag: string) => `(this document's language: ${tag})`,
    languageUnsupported: (tag: string) =>
      `This document's language (${tag}) is not supported, so English is used. Supported: German, English, Spanish, French and Japanese.`,
    languageFromSetting:
      'Your settings say to use the interface language rather than the one this document declares.',
    languageFromBrowser:
      'This document declares no language, so your browser’s language setting is used.',
    languageFallback:
      'This document declares no language and your browser’s language is not supported, so English is used.',
    downloadWarning:
      'The first run needs to download the AI model (several GB). It may take a while.',
    generate: (total: number) =>
      `Generate descriptions for ${total} ${total === 1 ? 'image' : 'images'}`,
    generating: 'Generating…',
    preparingModel: 'Preparing the AI model…',
    preparingModelAt: (percent: number) => `Preparing the AI model… ${percent}%`,
    generating_: 'Generating image descriptions…',
    describingPage: (pageNumber: number) => `Describing an image on page ${pageNumber}…`,
    describingPageOf: (pageNumber: number, total: number, index: number) =>
      `Describing an image on page ${pageNumber}… (${index} of ${total})`,
    noneDescribed: (failed: number) =>
      `Analysed, but no description could be generated for any of the ${failed}. See the list below.`,
    described: (count: number) =>
      `${count} ${count === 1 ? 'description' : 'descriptions'} generated.`,
    decorativeCount: (count: number) =>
      `${count} ${count === 1 ? 'was' : 'were'} judged decorative by the AI (which may be wrong).`,
    failedCount: (count: number) =>
      `${count} could not be described.`,
    failedToGenerate: (detail: string) => `Descriptions could not be generated. ${detail}`,
    outcomesSummary: (count: number) => `Result for each image (${count})`,
    outcomeLine: (pageNumber: number, indexOnPage: number) =>
      `Image ${indexOnPage} on page ${pageNumber}`,
    outcomeDescribed: 'description generated',
    outcomeDecorative: 'judged decorative by the AI',
    outcomeFailed: 'failed',
  },

  /**
   * Asking for one site.
   *
   * Every sentence here has to survive being read by somebody deciding whether
   * to grant an extension access to a site: it names the site, says what the
   * access is for, says it covers nothing else, and says how to take it back.
   */
  siteAccess: {
    offer: (host: string) =>
      `This extension has no access to ${host}, which is what it needs in order to read a file kept there.`,
    grant: (host: string) => `Allow access to ${host}`,
    scope:
      'That site only, and only for reading documents you open. Nothing is sent anywhere. You can take it back at any time from the browser’s own extensions page.',
    refused: 'The browser did not grant access, so the PDF still cannot be read.',
    failed: (detail: string) => `Access could not be requested. ${detail}`,
  },

  /**
   * The languages a description can be written in, named in the interface's
   * own language.
   *
   * Which languages these are is not this project's choice — it is the list
   * Chrome's built-in model supports — so the keys are fixed and only the
   * names are translated.
   */
  languages: {
    de: 'German',
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    ja: 'Japanese',
  },

  settings: {
    title: 'Settings',
    textAndSpacing: 'Text and spacing',
    zoomHint: 'Works alongside the browser’s own zoom (Ctrl and +).',
    fontSize: 'Text size',
    fontSizes: { small: 'Small', normal: 'Normal', large: 'Large', xlarge: 'Extra large' },
    lineHeight: 'Line spacing',
    lineHeights: { normal: 'Normal', relaxed: 'Relaxed', loose: 'Loosest' },
    measure: 'Column width',
    measures: { narrow: 'Narrow', normal: 'Normal', wide: 'Wide' },
    typeface: 'Typeface',
    typefaces: {
      system: 'System default',
      udNote: 'A universal-design typeface, if you have it installed',
      hyperlegibleNote: 'For low vision; included with the extension, Latin only',
    },
    typefaceHint:
      'Nothing is ever downloaded. Atkinson Hyperlegible is packaged inside the extension, so it always works — but it covers Latin only, and Japanese is drawn by the system face beside it. BIZ UDPGothic is used only if it is installed on this device.',
    theme: 'Theme',
    themes: { system: 'Follow the OS setting', light: 'Light', dark: 'Dark' },
    themeHint:
      'In a forced-colours mode such as Windows High Contrast, the OS palette wins over this setting.',
    structureHint:
      'Which reading a tagged PDF opens with. You can switch per document. If the document does not offer the one chosen here, the next one is used — and an untagged PDF can only be inferred, so this setting is not used for it.',
    language: 'Language',
    languageHint:
      "The language of this extension's own interface. It does not change the document, and on its own it does not change the language generated text is written in — that is “Language of AI-generated text”, below.",
    languageAuto: 'Follow the browser',
    languageAutoNote: (resolved: string) => `Currently: ${resolved}`,
    aiLanguage: 'Language of AI-generated text',
    aiLanguageHint:
      'Which language image descriptions are written in, and which language OCR reads a page as. Both follow the language the document declares — but a PDF can declare the wrong one, and nothing inside the file reveals that, so this is how to overrule it.',
    aiLanguageDocument: 'Follow the document',
    aiLanguageDocumentNote:
      'The language the PDF declares. Where it declares none, your browser’s.',
    aiLanguageInterface: 'Use the interface language',
    aiLanguageInterfaceNote: (language: string) =>
      `The language set at the top of this panel, which is ${language} right now.`,
    pdfHandler: 'Opening PDFs',
    pdfHandlerHint:
      'Which viewer opens a PDF you click. Switching to the Reader makes the browser ask for permission to read data on all sites: this extension has to recognise a PDF’s address before the page loads, and no browser allows that for sites it cannot already reach. Switching back hands it in again.',
    pdfHandlerBrowser: 'The browser’s own viewer',
    pdfHandlerBrowserNote: 'This extension opens when you press its toolbar button.',
    pdfHandlerReader: 'This Reader',
    pdfHandlerReaderNote: 'Addresses ending in .pdf, over http and https.',
    pdfHandlerLimits:
      'A PDF on your own computer still opens in the browser’s viewer: reading local files needs a switch on the browser’s extensions page that no extension can ask for. So does a PDF served from an address that does not end in .pdf, because what it is cannot be known before it is opened — the toolbar button opens both.',
    pdfHandlerRefused:
      'The browser did not grant that access, so PDFs still open in its own viewer.',
    pdfHandlerFailed: (detail: string) => `This could not be changed. ${detail}`,
    storage: 'Storage',
    storageHint:
      'Settings are stored on this device, and synced to your other devices if you are signed in to the browser.',
    reset: 'Reset to defaults',
    model: 'On-device AI',
    modelHint:
      'Used for image descriptions and OCR. It runs on this device; no image is sent anywhere.',
    modelUnavailable: 'Not available on this device.',
    modelUnavailableReason: {
      'unsupported-browser': "This browser does not support Chrome's built-in AI. Desktop Chrome is required.",
      'insufficient-hardware':
        'It needs 22 GB of free storage and either 16 GB of memory or 4 GB of VRAM.',
    },
    modelReady: 'Ready.',
    modelDownloadable:
      'Not ready yet. It needs a download of several GB. Getting it out of the way here means no wait when you open a document. An interrupted download resumes.',
    modelPrepare: 'Prepare the AI model',
    modelPreparing: 'Preparing…',
    modelPreparingAt: (percent: number) => `Preparing… ${percent}%`,
    modelPreparingPlain: 'Preparing…',
    modelFailed: (detail: string) => `Could not prepare it. ${detail}`,
  },

  /**
   * What went wrong, in the words the reader sees.
   *
   * Keyed by `PdfErrorMessage` rather than by `PdfErrorCode`: several
   * situations share a code — three different things are an unsupported
   * scheme — and collapsing them would replace a specific, actionable
   * sentence with a vague one. `explanation` is what to do about it; the
   * error's own `detail` carries anything technical (a status code, an
   * exception) and is shown after, untranslated, because it comes from the
   * browser rather than from here.
   */
  errors: {
    'file-scheme': {
      title: 'A local file (file://) cannot be opened by this extension yet.',
      explanation:
        'Reading one would require the "Allow access to file URLs" permission in Chrome’s extension settings, which this version does not ask for. Download the PDF and open it from a web URL, or open it in the browser’s own PDF viewer and click the extension icon there.',
    },
    'blob-scheme': {
      title: 'This PDF is displayed from a blob: URL, so the Reader cannot fetch it.',
      explanation:
        'A blob: URL is valid only inside the page that created it. Save the PDF from that page and open the saved file’s URL.',
    },
    'fetch-failed': {
      title: 'The PDF could not be fetched.',
      // No instructions here. Which route out exists depends on the browser and
      // on what access the extension already has, and the notice below the
      // error is what knows that — so this says what happened and stops.
      explanation:
        'It may be a network error, or this extension may have no access to the site the PDF is on. Reading a file from another site needs that access.',
    },
    'http-error': {
      title: 'The PDF could not be fetched.',
      explanation: '',
    },
    'not-a-pdf': {
      title: 'This does not appear to be a PDF.',
      explanation: '',
    },
    'handoff-expired': {
      title: 'This PDF has already been loaded, and could not be fetched again.',
      explanation:
        'That happens when the Reader tab is reloaded. Go back to the original PDF tab and click the extension icon again.',
    },
    'no-source': {
      title: 'No PDF was given to open.',
      explanation:
        'In a tab showing a PDF, click “Accessible PDF View” in the toolbar to open that PDF in the Reader.',
    },
    'tab-url-unavailable': {
      title: "This tab's URL could not be read.",
      explanation:
        'The extension can read a tab’s URL only at the moment its toolbar icon is clicked. Please try again.',
    },
    'unsupported-page': {
      title: 'This page cannot be opened in Accessible PDF View.',
      explanation:
        'PDFs cannot be read from a browser-internal page or an extension page. Run it in a tab that is showing a PDF.',
    },
    'parse-failed': {
      title: 'This PDF could not be analysed.',
      explanation: '',
    },
    'load-failed': { title: 'The PDF could not be loaded.', explanation: '' },
    'engine-failed': {
      title: 'The PDF analysis engine could not be started.',
      explanation: '',
    },
    'ocr-consent': {
      title: 'Running OCR needs your consent.',
      explanation:
        'This provider sends the document or its page images to an external service. It needs explicit consent before it runs.',
    },
    'ocr-unsupported-browser': {
      title: "This browser does not support Chrome's built-in AI.",
      explanation: 'Desktop Chrome is required.',
    },
    'ocr-local-unavailable': {
      title: 'Local OCR is not available yet.',
      explanation:
        'This version ships no OCR engine. The Original view can still show you the pages.',
    },
    unknown: { title: 'The PDF could not be opened.', explanation: '' },
  },
} as const;
