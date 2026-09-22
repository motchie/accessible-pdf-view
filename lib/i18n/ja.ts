import type { Messages } from './index';

/**
 * The Reader's interface in Japanese.
 *
 * Typed as `Messages`, which is `en.ts`'s shape: a key that exists there and
 * not here does not compile. That is deliberate and it is the whole reason
 * this catalogue is hand-rolled — see `index.ts`.
 *
 * These strings are the originals. The Reader was written in Japanese first
 * and English second, so nothing here is a translation of the English; the
 * English is the translation, and where the two say different things it is the
 * English that is wrong.
 *
 * The provenance labels — 「AIによる自動生成の説明」 and its siblings — are load-
 * bearing accessibility text rather than interface chrome. They state where a
 * piece of text came from, to a reader who cannot check it against the page.
 * Reword them only with the same care as the code they describe.
 */
export const ja: Messages = {
  app: {
    locale: 'ja',
    name: 'Accessible PDF View',
    skipToContent: '本文へスキップ',
    documentNote: (name: string, note: string) => `${name}（${note}）`,
    openInNewTab: '（新しいタブで開きます）',
    openInSidePanel: '（サイドパネルで開きます）',
    footerPrivacy:
      'この拡張機能は PDF をブラウザ内で解析します。通常の PDF が外部サーバーへ送信されることはありません。',
  },

  tabTitle: {
    fetching: '取得しています…',
    analyzing: '解析しています…',
    failed: '読み込めませんでした',
  },

  status: {
    fetching: 'PDF を取得しています。',
    analyzing: 'PDF を解析しています。',
    loadFailed: 'PDF を読み込めませんでした。',
    ready: (pageCount: number) => `PDF の解析が完了しました。${pageCount} ページ。`,
    readyNeedsOcr: (pageCount: number) =>
      `PDF の解析が完了しました。${pageCount} ページ。` +
      '一部のページには読み取り可能なテキストが含まれていません。OCR が必要です。',
  },

  /**
   * The three views, in katakana.
   *
   * They are names, and a name in a Japanese interface has to be readable as
   * Japanese — a screen reader meeting a bare `Reader` inside a Japanese
   * sentence either switches voice for one word or mispronounces it. The
   * English catalogue keeps the Latin spellings, because there they are the
   * names.
   *
   * Every other sentence that points at a view uses the same word, including
   * the ones about the Markdown *format*: one thing with two names is worse
   * than either name.
   */
  views: {
    selectLabel: '表示',
    reader: { label: 'リーダー', description: '構造化された読みやすい HTML' },
    original: { label: 'オリジナル', description: '元の PDF ページの見た目' },
    markdown: { label: 'マークダウン', description: '解析結果のマークダウン' },
    readerPanelLabel: 'リーダー',
    originalPanelLabel: 'オリジナル — 元の PDF ページの見た目',
    markdownPanelLabel: 'マークダウン',
  },

  toolbar: {
    documentActions: 'この文書の操作',
    print: '印刷',
    originalPdf: '元の PDF',
    originalOpensHere:
      '（新しいタブで開きますが、「PDF を開くビューアー」の設定により、このリーダーで開きます）',
    settings: '設定',
    settingsFailed: (detail: string) => `設定を開けませんでした。${detail}`,
  },

  structure: {
    legend: '構造の読み取り方',
    sources: {
      combined: {
        label: '構造タグ＋推測した見出し',
        detail:
          '作成者が指定した構造に、文字の配置から推測した見出しを加えたもの。構造タグに見出しがない PDF でのみ選べます。見出し以外は構造タグのままです。',
      },
      'tagged-pdf': {
        label: 'PDF の構造タグ',
        detail:
          '作成者が指定した構造。見出しのレベル、表の構造、作成者が書いた代替テキストを含みます。',
      },
      'pdf-inspector': {
        label: 'レイアウトからの推測',
        detail:
          '文字の配置から推測した構造。作成者が書いた代替テキストは読み取れず、ヘッダーやフッターが本文に混ざることがあります。',
      },
      ocr: { label: 'OCR の認識結果', detail: '画像から読み取った文字。' },
      'pdf-text': {
        label: 'テキスト抽出のみ',
        detail: '構造を読み取れなかったページから、文字だけを取り出したもの。',
      },
    },
    headingCount: (count: number) => `見出し ${count} 件。`,
    reloading: (label: string) => `${label}で読み直しています。`,
    reloadFailed: (detail: string) => `読み直せませんでした。${detail}`,
    staysWithReading:
      '生成した画像の説明と OCR の結果は、適用した読み取り方にのみ残ります。もう一方に切り替えると表示されませんが、戻せば残っています。',
  },

  documentInfo: {
    summary: '文書情報',
    author: '作成者',
    subject: '件名',
    keywords: 'キーワード',
    language: '言語',
    pageCount: 'ページ数',
    created: '作成日時',
    modified: '更新日時',
    creator: '作成ソフトウェア',
    producer: 'PDF 生成',
    pdfVersion: 'PDF バージョン',
    tagged: '構造タグ',
    taggedYes: 'あり (Tagged PDF)',
    taggedNo: 'なし',
    thisView: 'この画面の構造',
    pages: (count: number) => `${count} ページ`,
    structure: {
      combined: 'PDF の構造タグから取得し、レイアウトから推測した見出しを追加',
      'tagged-pdf': 'PDF の構造タグから取得（作成者が指定した構造）',
      'pdf-inspector': 'レイアウトから推測',
      ocr: 'OCR による認識結果',
    },
    untaggedNote:
      'この PDF には構造タグが含まれていないため、文字の配置から見出しや表を推測しています。実際の文書構造と異なる場合があります。',
    combinedNote:
      'この PDF の構造タグには見出しがありません。この画面の見出しはすべて文字の配置から推測したもので、見出し以外は作成者が指定した構造です。推測した見出しは実際の文書構造と異なる場合があります。',
  },

  markdown: {
    legend: 'マークダウンの内容',
    sameAsReader: 'リーダーと同じ内容',
    sameAsReaderDetail: (reading: string) => `いまリーダーが表示している「${reading}」の内容。`,
    sameAsReaderDetailPlain: 'リーダーの表示内容。',
    generatedAreMarked:
      '生成した画像の説明が含まれる場合、「AIによる自動生成の説明」と明記されます。',
    rawOutput: 'pdf-inspector の生出力',
    rawOutputDetail:
      'パーサーが出力したマークダウンそのもの。この PDF を解析器がどう読んだかの記録で、リーダーの内容とは異なることがあります。',
    copy: 'マークダウンをコピー',
    copied: 'マークダウンをコピーしました。',
    copyFailed: 'コピーできませんでした。テキストを選択してコピーしてください。',
    emptyNoText:
      'この PDF からはマークダウンが生成されませんでした。テキストを含まないページのみで構成されている場合に起こります。オリジナルタブで元のページを確認できます。',
    empty: '表示できる内容がありません。',
  },

  original: {
    pageHeading: (pageNumber: number) => `${pageNumber} ページ`,
    pageImageOnly: (pageNumber: number) =>
      `${pageNumber} ページ。このページは画像として表示されています。現在テキストを取得できません。`,
    pageNormal: (pageNumber: number) =>
      `${pageNumber} ページ。元の PDF の見た目を表示しています。テキストはリーダータブで読めます。`,
    rendering: 'このページを描画しています…',
  },

  figures: {
    withGeneratedAlt: (text: string) => `画像（AIによる自動生成の説明）: ${text}`,
    withOcrText: (text: string) => `画像（画像内から読み取った文字）: ${text}`,
    withDocumentAiAlt: (text: string) => `画像（文書作成ソフトが自動生成した説明）: ${text}`,
    withAlt: (text: string) => `画像: ${text}`,
    decorative: '装飾的な画像です。内容はありません。',
    decorativeGuess:
      '画像があります。AIは装飾的な画像と判定しましたが、これは自動判定であり誤っている可能性があります。',
    unavailable: '画像がありますが、表示できませんでした。',
    describeFailed: '画像があります。内容を解析しましたが、説明を生成できませんでした。',
    noAlt: '画像があります。代替テキストを取得できませんでした。',
    table: '表',
    tableWithCaption: (caption: string) => `表: ${caption}`,
    pageLabel: (pageNumber: number) => `${pageNumber} ページ`,
  },

  notices: {
    retry: 'もう一度読み込む',
    ocrRequired: {
      title: 'OCR が必要です',
      wholeDocument: 'この PDF には読み取り可能なテキストが含まれていません。',
      onePage: (pageNumber: number) =>
        `この PDF の ${pageNumber} ページ目には読み取り可能なテキストが含まれていません。`,
      pages: (pageList: string) =>
        `この PDF の次のページには読み取り可能なテキストが含まれていません: ${pageList} ページ。`,
      mayHelp: 'OCR（文字認識）を行うと読めるようになる可能性があります。',
      originalHint: 'オリジナルタブでは元のページの見た目を確認できます。',
      encodingIssue:
        'なお、この PDF には文字コードの問題が検出されています。抽出されたテキストが正しく読めない場合があります。',
    },
    pageLabel: (pageNumber: number) => `${pageNumber} ページ: `,
    ocrPage:
      'このページの文字はOCR（機械による文字認識）で読み取ったものです。誤りを含む可能性があります。',
    carriedFigures: (count: number) =>
      `このページの画像 ${count} 件は本文のうしろにまとめています。読み取った文字には位置の情報がないため、元のページでの位置は反映されていません。`,
    recoveredPage:
      'このページは解析器が読み取れなかったため、文字だけを取り出して表示しています。見出しや表などの構造は失われています。',
    noHeadings: (otherLabel: string, otherCount: number) =>
      `いま表示している読み取り方には見出しがありません。見出しジャンプでは移動できません。「${otherLabel}」に切り替えると、見出しが ${otherCount} 件あります。`,
  },

  pageContent: {
    garbled:
      'このページの文字は、フォントの情報が壊れているため正しく読み取れません。文字自体は存在しますが、意味のある文字列として取り出せません。OCR（文字認識）を行うと読める可能性があります。',
    image:
      'このページの内容は画像として保存されているため、テキストとして取り出せません。OCR（文字認識）を行うと読める可能性があります。',
    vector:
      'このページの文字は図形（アウトライン）として描かれているため、テキストとして取り出せません。画像は含まれていません。OCR（文字認識）を行うと読める可能性があります。',
    blank: 'このページには読み取れる内容が見つかりませんでした。',
    unknown:
      'このページからテキストを取得できませんでした。OCR（文字認識）を行うと読める可能性があります。',
  },

  ocrPanel: {
    heading: 'OCR（文字認識）',
    unavailable: (pageCount: number) =>
      `テキストを取得できないページが ${pageCount} 件あります。この端末では OCR を実行できません。`,
    unavailableWhy:
      'この拡張機能の OCR は Chrome の内蔵AIを使い、端末上で処理します。Chrome のデスクトップ版と、空き容量 22GB・16GB のメモリまたは 4GB の VRAM が必要です。',
    available: (pageCount: number) =>
      `テキストを取得できないページが ${pageCount} 件あります。Chrome の内蔵AIを使って、端末上で文字を読み取れます。`,
    caveat: (language: string) =>
      `OCR が読み取った文字は**機械による読み取り結果**であり、誤りを含む可能性があります。リーダー上では「OCRで読み取ったページ」と明示されます。処理はすべてこの端末内で行われ、ページ画像が外部へ送信されることはありません。読み取りは${language}として行います。`,
    languageFromSetting:
      '設定により、文書が宣言している言語ではなく、表示言語として読み取ります。',
    howItRuns:
      '読み取りは1ページずつ行い、読み取れたページから順に本文へ反映します。途中で中止しても、それまでに読み取ったページはそのまま残ります。',
    readAll: (pageCount: number) => `${pageCount} ページすべてを読み取る`,
    reading: '読み取り中…',
    perPageHeading: 'ページごとに読み取る',
    readPage: (pageNumber: number) => `${pageNumber} ページを読み取る`,
    stop: '読み取りを中止',
    failed: (detail: string) => `OCR を実行できませんでした。${detail}`,
    preparing: '読み取りを準備しています…',
    readingPage: (pageNumber: number) => `${pageNumber} ページを読み取っています…`,
    readingPageOf: (pageNumber: number, total: number, index: number) =>
      `${pageNumber} ページを読み取っています…（${total} ページ中 ${index} 件目）`,
    stoppedNothing: '読み取りを中止しました。読み取れたページはありません。',
    stoppedAfter: (pages: string) => `${pages}を読み取った時点で中止しました。`,
    notRead: (count: number) => `残り ${count} ページは読み取っていません。`,
    nothingRead: (attempted: number) =>
      `${attempted} ページを解析しましたが、文字を読み取れませんでした。`,
    read: (pages: string) => `${pages}を読み取りました。`,
    couldNotRead: (count: number) => `${count} ページは読み取れませんでした。`,
    pageList: (pageNumbers: readonly number[]) => `${pageNumbers.join(', ')} ページ`,
    pageCountOnly: (count: number) => `${count} ページ`,
  },

  describePanel: {
    heading: '画像の説明',
    intro: (total: number) =>
      `この文書には、作成者による代替テキストがない画像が ${total} 件あります。Chrome の内蔵AIを使って、端末上で説明を生成できます。`,
    machineWritten: (machineWritten: number, missing: number) =>
      `うち ${machineWritten} 件には、文書作成ソフト（Word など）が自動生成した説明が入っています。作成者が書いたものではないため、生成の対象に含めています。` +
      (missing > 0 ? ` 残り ${missing} 件は代替テキストがありません。` : ''),
    caveat:
      '生成された説明は**AIによる推測**であり、文書の作成者によるものではありません。誤りを含む可能性があります。リーダー上では「AIによる自動生成の説明」と明示されます。処理はすべてこの端末内で行われ、画像が外部へ送信されることはありません。',
    languageIs: (language: string) => `説明は${language}で生成されます。`,
    languageFromDocument: (tag: string) => `（この文書の言語: ${tag}）`,
    languageUnsupported: (tag: string) =>
      `この文書の言語（${tag}）には対応していないため、英語になります。対応しているのは ドイツ語・英語・スペイン語・フランス語・日本語 です。`,
    languageFromSetting:
      '設定により、この文書が宣言している言語ではなく、表示言語を使用しています。',
    languageFromBrowser: 'この文書は言語を宣言していないため、ブラウザの言語設定を使用しています。',
    languageFallback:
      'この文書は言語を宣言しておらず、ブラウザの言語にも対応していないため、英語になります。',
    downloadWarning: '初回はAIモデルのダウンロード（数GB）が必要です。時間がかかる場合があります。',
    generate: (total: number) => `${total} 件の画像の説明を生成`,
    generating: '生成中…',
    preparingModel: 'AIモデルを準備しています…',
    preparingModelAt: (percent: number) => `AIモデルを準備しています… ${percent}%`,
    generating_: '画像の説明を生成しています…',
    describingPage: (pageNumber: number) => `${pageNumber} ページ目の画像を説明しています…`,
    describingPageOf: (pageNumber: number, total: number, index: number) =>
      `${pageNumber} ページ目の画像を説明しています…（${total} 件中 ${index} 件目）`,
    noneDescribed: (failed: number) =>
      `解析しましたが、${failed} 件すべての画像で説明を生成できませんでした。詳細は下の一覧をご確認ください。`,
    described: (count: number) => `${count} 件の説明を生成しました。`,
    decorativeCount: (count: number) =>
      `${count} 件はAIが装飾的な画像と判定しました（誤判定の可能性があります）。`,
    failedCount: (count: number) => `${count} 件は説明できませんでした。`,
    failedToGenerate: (detail: string) => `説明を生成できませんでした。${detail}`,
    outcomesSummary: (count: number) => `各画像の処理結果（${count} 件）`,
    outcomeLine: (pageNumber: number, indexOnPage: number) =>
      `${pageNumber} ページ目の ${indexOnPage} 番目の画像`,
    outcomeDescribed: '説明を生成',
    outcomeDecorative: 'AIが装飾的と判定',
    outcomeFailed: '失敗',
  },

  siteAccess: {
    offer: (host: string) =>
      `この拡張機能は ${host} へのアクセス権を持っていません。そのサイトにあるファイルを読むには、この権限が必要です。`,
    grant: (host: string) => `${host} へのアクセスを許可する`,
    scope:
      'このサイトだけが対象で、用途は開いた文書を読むことに限られます。外部へ送信されるものはありません。ブラウザの拡張機能の設定画面から、いつでも取り消せます。',
    refused: '許可されなかったため、この PDF はまだ読み取れません。',
    failed: (detail: string) => `許可を要求できませんでした。${detail}`,
  },

  languages: {
    de: 'ドイツ語',
    en: '英語',
    es: 'スペイン語',
    fr: 'フランス語',
    ja: '日本語',
  },

  settings: {
    title: '設定',
    textAndSpacing: '文字と余白',
    zoomHint: 'ブラウザのズーム（Ctrl と ＋）と併用できます。',
    fontSize: '文字サイズ',
    fontSizes: { small: '小', normal: '標準', large: '大', xlarge: '特大' },
    lineHeight: '行間',
    lineHeights: { normal: '標準', relaxed: 'ゆったり', loose: '最大' },
    measure: '本文の幅',
    measures: { narrow: '狭い', normal: '標準', wide: '広い' },
    typeface: '書体',
    typefaces: {
      system: 'システム標準',
      udNote: 'ユニバーサルデザイン書体。端末にある場合に使われます',
      hyperlegibleNote: 'ロービジョン向け。拡張機能に同梱、欧文のみ',
    },
    typefaceHint:
      '外部から取得することはありません。Atkinson Hyperlegible はこの拡張機能に同梱しているため必ず使えますが、欧文のみのため、日本語はシステムの書体で表示されます。BIZ UDPGothic は端末にインストールされている場合のみ使われます。',
    theme: 'テーマ',
    themes: { system: 'OS の設定に従う', light: 'ライト', dark: 'ダーク' },
    themeHint:
      'Windows のハイコントラストなど強制カラーモードでは、この設定より OS の配色が優先されます。',
    structureHint:
      '構造タグを持つ PDF を開いたときに、最初に表示する読み取り方です。文書ごとに切り替えられます。その文書にない読み取り方を選んでいる場合は、次の候補が使われます。タグを持たない PDF は推測しかできないため、この設定は使われません。',
    language: '表示言語',
    languageHint:
      'この拡張機能の画面の言語です。文書そのものの言語は変わりません。AI が生成する文章の言語も、この設定だけでは変わりません（下の「AI が生成する文章の言語」で選びます）。',
    languageAuto: 'ブラウザに従う',
    languageAutoNote: (resolved: string) => `現在: ${resolved}`,
    aiLanguage: 'AI が生成する文章の言語',
    aiLanguageHint:
      '画像の説明を生成する言語と、OCR がページを読み取る言語です。どちらも文書が宣言している言語に従いますが、PDF が誤った言語を宣言していることもあり、ファイルの中身からはそれを判別できません。その場合にここで上書きします。',
    aiLanguageDocument: '文書に従う',
    aiLanguageDocumentNote: '文書が宣言している言語。宣言がない場合はブラウザの言語。',
    aiLanguageInterface: '表示言語を使う',
    aiLanguageInterfaceNote: (language: string) =>
      `このパネルの先頭で設定した表示言語（現在は${language}）。`,
    pdfHandler: 'PDF を開くビューアー',
    pdfHandlerHint:
      'クリックした PDF をどのビューアーで開くかです。リーダーに切り替えると、すべてのサイトのデータを読み取る権限をブラウザが確認します。ページが読み込まれる前に PDF のアドレスを判別する必要があり、アクセスできないサイトではそれが許可されないためです。元に戻すと、この権限は返却されます。',
    pdfHandlerBrowser: 'ブラウザ標準のビューアー',
    pdfHandlerBrowserNote: 'この拡張機能は、ツールバーのボタンを押したときに開きます。',
    pdfHandlerReader: 'このリーダー',
    pdfHandlerReaderNote: '.pdf で終わるアドレスの、http と https のみ。',
    pdfHandlerLimits:
      '端末内にある PDF は、これまでどおりブラウザ標準のビューアーで開きます。ローカルファイルの読み取りには、拡張機能側からは要求できないブラウザ側の設定が必要なためです。.pdf で終わらないアドレスで配信される PDF も、開く前には判別できないため同様です。どちらもツールバーのボタンから開けます。',
    pdfHandlerRefused:
      '権限が許可されなかったため、PDF はこれまでどおりブラウザ標準のビューアーで開きます。',
    pdfHandlerFailed: (detail: string) => `変更できませんでした。${detail}`,
    storage: '保存',
    storageHint:
      '設定はこの端末に保存され、ブラウザにサインインしていれば他の端末にも同期されます。',
    reset: '初期状態に戻す',
    model: '端末内 AI',
    modelHint:
      '画像の説明と OCR に使います。処理はこの端末で行われ、画像が外部へ送信されることはありません。',
    modelUnavailable: 'この端末では利用できません。',
    modelUnavailableReason: {
      'unsupported-browser':
        'このブラウザは Chrome 内蔵AI に対応していません。Chrome のデスクトップ版が必要です。',
      'insufficient-hardware':
        '空き容量 22GB と、16GB のメモリまたは 4GB のVRAM が必要です。',
    },
    modelReady: '準備できています。',
    modelDownloadable:
      'まだ準備できていません。数 GB のダウンロードが必要です。文書を開く前にここで済ませておくと、待たずに使えます。中断しても再開されます。',
    modelPrepare: 'AI モデルを準備する',
    modelPreparing: '準備中…',
    modelPreparingAt: (percent: number) => `準備しています… ${percent}%`,
    modelPreparingPlain: '準備しています…',
    modelFailed: (detail: string) => `準備できませんでした。${detail}`,
  },

  errors: {
    'file-scheme': {
      title: 'ローカルファイル (file://) の PDF は、この拡張機能ではまだ開けません。',
      explanation:
        'Chrome の拡張機能設定で「ファイルの URL へのアクセスを許可する」が必要になるため、このバージョンでは要求していません。PDF をダウンロードして Web 上の URL で開くか、ブラウザの PDF ビューアーで開いた状態で拡張機能のアイコンをクリックしてください。',
    },
    'blob-scheme': {
      title: 'この PDF は blob: URL で表示されているため、リーダーから取得できません。',
      explanation:
        'blob: URL は生成元のページ内でのみ有効です。元のページから PDF を保存し、保存したファイルの URL で開いてください。',
    },
    'fetch-failed': {
      title: 'PDF を取得できませんでした。',
      explanation:
        'ネットワークエラー、またはこの拡張機能が PDF のあるサイトへのアクセス権を持っていない可能性があります。別のサイトにあるファイルを読むには、その権限が必要です。',
    },
    'http-error': { title: 'PDF を取得できませんでした。', explanation: '' },
    'not-a-pdf': { title: 'これは PDF ではないようです。', explanation: '' },
    'handoff-expired': {
      title: 'この PDF のデータは読み込み済みのため、再取得できませんでした。',
      explanation:
        'リーダーのタブを再読み込みした場合に起こります。元の PDF のタブに戻り、もう一度拡張機能のアイコンをクリックしてください。',
    },
    'no-source': {
      title: '開く PDF が指定されていません。',
      explanation:
        'PDF を表示しているタブでツールバーの「Accessible PDF View」をクリックすると、その PDF をリーダーで開けます。',
    },
    'tab-url-unavailable': {
      title: 'このタブの URL を取得できませんでした。',
      explanation:
        'ツールバーのアイコンをクリックした時点でのみ、拡張機能はタブの URL を読み取れます。もう一度お試しください。',
    },
    'unsupported-page': {
      title: 'このページは Accessible PDF View で開けません。',
      explanation:
        'ブラウザの内部ページや拡張機能のページからは PDF を読み取れません。PDF を表示しているタブで実行してください。',
    },
    'parse-failed': { title: 'この PDF を解析できませんでした。', explanation: '' },
    'load-failed': { title: 'PDF を読み込めませんでした。', explanation: '' },
    'engine-failed': { title: 'PDF 解析エンジンを起動できませんでした。', explanation: '' },
    'ocr-consent': {
      title: 'OCR の実行には同意が必要です。',
      explanation:
        'このプロバイダーは文書またはページ画像を外部サービスへ送信します。実行前に明示的な同意が必要です。',
    },
    'ocr-unsupported-browser': {
      title: 'このブラウザは Chrome 内蔵AI に対応していません。',
      explanation: 'Chrome のデスクトップ版が必要です。',
    },
    'ocr-local-unavailable': {
      title: 'ローカル OCR はまだ利用できません。',
      explanation:
        'このバージョンには OCR エンジンが含まれていません。オリジナルビューで元のページを表示できます。',
    },
    unknown: { title: 'PDF を開けませんでした。', explanation: '' },
  },
};
