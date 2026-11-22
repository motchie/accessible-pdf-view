import type {
  AccessibleDocument,
  DocumentNode,
  InlineNode,
  TableCell,
  TableRow,
  TextNode,
} from './document-model';
import { inlineToPlainText } from './document-model';
import { normalizeCjkSpacing } from './inspector/markdown-to-document';
import { HANGUL, KANA } from './pdfjs/language';
import { comparableTitle } from './repeated-title';

/**
 * Which language each block and run of a document is marked as (#49).
 *
 * The tagged adapter records, on every run, the language its structure
 * elements declare for it — the run's own `/Lang`, else its nearest
 * ancestor's. This decides what of that is worth saying, once the document's
 * own language is known: the catalog's `/Lang`, or what detection found when
 * there is none. It runs from `decorate`, because that is where the document's
 * language is settled, and before then the corrections below have nothing to
 * compare a declaration with.
 *
 * Per block (heading, paragraph, table cell):
 *
 *   - Each run with letters gets its *voiced* language: its declaration, after
 *     the corrections in `voicedLanguage`. A corrected declaration says
 *     nothing, and the run is in the document's language.
 *   - When every run with letters is voiced the same, that is the block's
 *     language. Word declares languages on runs, not paragraphs, so this is
 *     how a paragraph of English runs becomes `<p lang="en">` rather than one
 *     `<span lang>` per run. A block that disagrees with itself is in the
 *     document's language.
 *   - A run whose voiced language is not the block's keeps it, and a
 *     `<span lang>` says so. Runs without letters — digits, punctuation,
 *     whitespace — never keep one.
 *
 * "The same" compares languages, not tags: `en` and `en-US` are one language
 * here, `en-GB` and `en-US` are two (`sameLanguage`).
 *
 * The title (`title`, from the document information) declares no language
 * of its own. `titleLanguage` says when the document's tags show it to be in
 * one other than the document's; see `titleLanguageFrom`. `tagsCoverText`
 * says whether the tags carry most of the page text: without that, only a
 * heading that says the same as the title may decide its language.
 *
 * `chosen`: the document's language is one the reader chose (#57), not one
 * the file gave. Then the file's part-level declarations are dropped too,
 * except where the text's writing system shows a language of another family
 * (`chosenVoicedLanguage`), and the title takes the chosen language.
 *
 * Settling works from each run's `declaredLanguage`, which it never changes,
 * so settling a settled document — again, or against another language — gives
 * the same answer as settling it once. `decorate` runs more than once on a
 * reading, and again when the reader chooses a language.
 */
export function settleDeclaredLanguages(
  document: AccessibleDocument,
  documentLanguage: string | undefined,
  options: { title?: string; tagsCoverText?: boolean; chosen?: boolean } = {},
): AccessibleDocument {
  if (!declaresAnyLanguage(document)) return document;
  const voice: Voicing = options.chosen
    ? (text, declared) => chosenVoicedLanguage(text, declared, documentLanguage)
    : (text, declared) => voicedLanguage(text, declared, documentLanguage);
  const pages = document.pages.map((page) => ({
    ...page,
    nodes: page.nodes.map((node) => settleBlock(node, documentLanguage, voice)),
  }));
  const { titleLanguage: _previous, ...metadata } = document.metadata;
  const titleLanguage =
    options.title && !options.chosen
      ? titleLanguageFrom(pages, options.title, documentLanguage, options.tagsCoverText ?? false)
      : undefined;
  return { ...document, metadata: { ...metadata, ...(titleLanguage ? { titleLanguage } : {}) }, pages };
}

/**
 * The title's language, from what the document's tags declare, when that
 * differs from the document's. Two sources, in order:
 *
 *   1. A heading or paragraph that says the same as the title. Word writes the
 *      title property and the title on the page separately, and when they
 *      agree the paragraph's language is the title's.
 *   2. Every run with letters in the document, when they all agree on one
 *      language. Not a majority: a document whose every word says English is
 *      an English document whatever its catalog says, while one that mixes
 *      languages gives the title no answer, and it keeps the document's. Only
 *      when the tags carry most of the page text (`tagsCoverText`): a tree
 *      that tags one English logo line says nothing about the rest.
 *
 * Either way the title text must bear the language out, by the rules runs
 * follow (`voicedLanguage`): a title with Japanese in it is not marked English.
 */
function titleLanguageFrom(
  pages: AccessibleDocument['pages'],
  title: string,
  documentLanguage: string | undefined,
  tagsCoverText: boolean,
): string | undefined {
  const wanted = comparableTitle(title);
  if (!wanted || !LETTER.test(wanted)) return undefined;
  const nodes = pages.flatMap((page) => page.nodes);

  const same = nodes.find(
    (node): node is Extract<DocumentNode, { type: 'heading' | 'paragraph' }> =>
      (node.type === 'heading' || node.type === 'paragraph') &&
      comparableTitle(inlineToPlainText(node.content)) === wanted,
  );
  const candidate = same
    ? (same.language ?? null)
    : tagsCoverText
      ? unanimousLanguage(nodes)
      : null;
  if (!candidate) return undefined;
  const voiced = voicedLanguage(wanted, candidate, documentLanguage);
  return voiced && !sameLanguage(voiced, documentLanguage) ? voiced : undefined;
}

/**
 * The language every run with letters in a settled document is declared in,
 * when they all agree on one other than `documentLanguage`; else undefined.
 *
 * Unanimity, not a majority. An English document exported from a Japanese
 * Word says `ja` in its catalog and `en` on every run: its text is English,
 * and the Reader reads it as English in every reading, the inferred one
 * included, which cannot see a run's language (#49). A document that mixes
 * languages, or declares none on its runs, keeps the catalog's.
 */
export function unanimousDeclaredLanguage(
  document: AccessibleDocument,
  documentLanguage: string | undefined,
): string | undefined {
  const found = unanimousLanguage(document.pages.flatMap((page) => page.nodes));
  return found && !sameLanguage(found, documentLanguage) ? found : undefined;
}

/** The one language every run with letters is in, after settling, or null. */
function unanimousLanguage(nodes: DocumentNode[]): string | null {
  let found: string | undefined | null = null;
  let agreed = true;
  const see = (language: string | undefined) => {
    if (found === null) found = language;
    else if (!sameLanguage(found, language)) agreed = false;
  };
  const inInline = (content: InlineNode[], around: string | undefined) => {
    for (const node of content) {
      if (node.type === 'link') inInline(node.content, around);
      else if (node.type === 'text' && LETTER.test(node.text)) see(node.language ?? around);
    }
  };
  const inBlocks = (blocks: DocumentNode[]) => {
    for (const node of blocks) {
      switch (node.type) {
        case 'heading':
        case 'paragraph':
        case 'unknown':
          inInline(node.content, node.language);
          break;
        case 'list':
          for (const item of node.items) inBlocks(item.blocks);
          break;
        case 'blockquote':
          inBlocks(node.blocks);
          break;
        case 'table':
          for (const row of [...(node.header ? [node.header] : []), ...node.rows]) {
            for (const cell of row.cells) {
              inInline(cell.content, cell.language);
              inBlocks(cell.blocks ?? []);
            }
          }
          break;
        default:
          break;
      }
    }
  };
  inBlocks(nodes);
  return agreed && found ? found : null;
}


/** A run's voiced language, given its text and what the file declares for it. */
type Voicing = (text: string, declared: string | undefined) => string | undefined;

function settleBlock(
  node: DocumentNode,
  documentLanguage: string | undefined,
  voice: Voicing,
): DocumentNode {
  switch (node.type) {
    case 'heading':
    case 'paragraph':
    case 'unknown': {
      const { language, content } = settleText(node.content, documentLanguage, voice);
      const { language: _previous, ...rest } = node;
      return { ...rest, content, ...(language ? { language } : {}) };
    }
    case 'list':
      return {
        ...node,
        items: node.items.map((item) => ({
          blocks: item.blocks.map((block) => settleBlock(block, documentLanguage, voice)),
        })),
      };
    case 'table': {
      const settleRow = (row: TableRow): TableRow => ({
        cells: row.cells.map((cell) => settleCell(cell, documentLanguage, voice)),
      });
      return {
        ...node,
        ...(node.header ? { header: settleRow(node.header) } : {}),
        rows: node.rows.map(settleRow),
      };
    }
    case 'blockquote':
      return {
        ...node,
        blocks: node.blocks.map((block) => settleBlock(block, documentLanguage, voice)),
      };
    default:
      return node;
  }
}

function settleCell(
  cell: TableCell,
  documentLanguage: string | undefined,
  voice: Voicing,
): TableCell {
  const { language, content } = settleText(cell.content, documentLanguage, voice);
  const { language: _previous, ...rest } = cell;
  return {
    ...rest,
    content,
    ...(language ? { language } : {}),
    ...(cell.blocks
      ? { blocks: cell.blocks.map((block) => settleBlock(block, documentLanguage, voice)) }
      : {}),
  };
}

/** A block's language and its runs, from what the file declares for each run. */
function settleText(
  content: InlineNode[],
  documentLanguage: string | undefined,
  voice: Voicing,
): { language: string | undefined; content: InlineNode[] } {
  // Each run's voiced language, worked out once.
  const voiced = new Map<TextNode, string | undefined>();
  const visit = (nodes: InlineNode[]) => {
    for (const node of nodes) {
      if (node.type === 'link') visit(node.content);
      else if (node.type === 'text' && LETTER.test(node.text)) {
        voiced.set(node, voice(node.text, node.declaredLanguage));
      }
    }
  };
  visit(content);

  const values = [...voiced.values()];
  const first = values[0];
  const agreed = values.length > 0 && values.every((value) => sameLanguage(value, first));
  const language = agreed && first && !sameLanguage(first, documentLanguage) ? first : undefined;
  // What a run without its own `lang` is read in.
  const around = language ?? documentLanguage;

  let changed = false;
  const strip = (nodes: InlineNode[]): InlineNode[] =>
    nodes.map((node): InlineNode => {
      if (node.type === 'link') return { ...node, content: strip(node.content) };
      if (node.type !== 'text') return node;
      const own = voiced.get(node);
      if (own !== undefined && !sameLanguage(own, around)) {
        if (own === node.language) return node;
        changed = true;
        return { ...node, language: own };
      }
      // Its language is the one around it: nothing to mark, and a candidate
      // for joining its neighbours.
      changed = true;
      if (node.language === undefined) return node;
      const { language: _dropped, ...rest } = node;
      return rest;
    });
  const stripped = strip(content);

  return { language, content: changed ? joinRuns(stripped) : stripped };
}

/**
 * Joins neighbouring runs that now read alike — same emphasis, same language —
 * and repairs the Japanese spacing where they meet. The tagged adapter has
 * already done both within each run; this only covers the joins that settling
 * made possible, such as 「2026」 declared `en` and 「 年」 declared `zh`, both
 * now in the document's language.
 */
function joinRuns(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    const previous = out[out.length - 1];
    if (node.type === 'link') {
      out.push({ ...node, content: joinRuns(node.content) });
      continue;
    }
    if (
      node.type === 'text' &&
      previous?.type === 'text' &&
      (previous.emphasis ?? []).join('|') === (node.emphasis ?? []).join('|') &&
      previous.language === node.language
    ) {
      // Each run's whitespace was collapsed on its own; the join can still
      // put two spaces side by side. A joined run keeps a declaration only
      // when both halves made the same one: two runs read alike in this
      // document's language, and the joined one is read in it again.
      const { declaredLanguage: _mixed, ...joined } = previous;
      out[out.length - 1] = {
        ...joined,
        text: normalizeCjkSpacing(`${previous.text}${node.text}`.replace(/\s+/g, ' ')),
        ...(previous.declaredLanguage !== undefined &&
        previous.declaredLanguage === node.declaredLanguage
          ? { declaredLanguage: previous.declaredLanguage }
          : {}),
      };
      continue;
    }
    out.push(node);
  }
  return out;
}

/** A letter of any script. Text without one has no language to speak in. */
const LETTER = /\p{L}/u;
const CJK_LETTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK = new Set(['ja', 'zh', 'ko']);

/**
 * The language a run with letters is worth marking as, given what the PDF
 * declares for it and the document's language. Undefined: the document's.
 *
 * Word declares a language on every run, and in a Japanese document the
 * declarations are not all ones an author made. Measured on this project's
 * Japanese Word fixtures: every run of half-width digits says `en`
 * (「2026」, 「31」, 「1,567」), runs of plain Japanese say `zh` (「年」,
 * 「日時点）」, a company's name), and a document whose default language was
 * English says `en` on its Japanese headings and table cells. Marked as
 * declared, a screen reader that follows `lang` would read 「2026 年 5 月 31
 * 日」 in three voices. So, limited to what the text itself shows:
 *
 *   - Digits and punctuation never reach here (see `LETTER`).
 *   - A run with Han, kana or hangul in it and declared a language outside
 *     Chinese, Japanese and Korean says nothing. 「営業」 cannot be English, and
 *     a voice for English cannot read 「PDFを開く」's kana either.
 *   - The reverse: a run with none of them, declared Chinese, Japanese or
 *     Korean, says nothing either. 「Annual Report」 declared `ja` in an English
 *     document is English text, and a Japanese voice would read it as such.
 *   - Where the run is declared Chinese, Japanese or Korean and the document
 *     is in another of the three, the declaration stands only if the text
 *     shows it: kana for Japanese, hangul for Korean, and for Chinese nothing
 *     at all, since its Han characters are Japanese and Korean too.
 *
 * Runs in another script keep their declaration: 「Accessible PDF View」
 * marked `en` in a Japanese document is the case the attribute exists for.
 */
function voicedLanguage(
  text: string,
  declared: string | undefined,
  documentLanguage: string | undefined,
): string | undefined {
  if (!declared) return undefined;
  const declaredPrimary = primary(declared);
  if (!CJK.has(declaredPrimary)) return CJK_LETTER.test(text) ? undefined : declared;
  // The mirror image: Word declares its East Asian language on full-width and
  // Latin runs alike, and English words declared Japanese would be read in a
  // Japanese voice. With no Han, kana or hangul, the text cannot show it.
  if (!CJK_LETTER.test(text)) return undefined;

  if (!documentLanguage) return declared;
  const documentPrimary = primary(documentLanguage);
  if (declaredPrimary === documentPrimary || !CJK.has(documentPrimary)) return declared;
  const shown =
    (declaredPrimary === 'ja' && KANA.test(text)) || (declaredPrimary === 'ko' && HANGUL.test(text));
  return shown ? declared : undefined;
}

/**
 * A run's voiced language when the reader chose the document's (`chosen`).
 *
 * The reader's choice is about the document; a file whose declarations were
 * wrong enough to need it is not trusted for its parts either. So a part keeps
 * a declaration only when its own writing system shows a language of another
 * family than the chosen one — Japanese with kana inside a document chosen as
 * Romanian, English words inside one chosen as Japanese — by the rules
 * `voicedLanguage` applies. Within one family (Romanian chosen, Spanish
 * declared) the choice wins: the text cannot show which is right, and the
 * reader said which.
 */
function chosenVoicedLanguage(
  text: string,
  declared: string | undefined,
  chosen: string | undefined,
): string | undefined {
  if (!declared || !chosen) return undefined;
  if (CJK.has(primary(declared)) === CJK.has(primary(chosen))) return undefined;
  return voicedLanguage(text, declared, chosen);
}

function primary(tag: string): string {
  return tag.split('-')[0]!.toLowerCase();
}

/**
 * Whether two tags name the same language for a reader: equal, or one a
 * prefix of the other at a subtag boundary. `en` and `en-US` are the same;
 * `en-GB` and `en-US`, and `zh-Hans` and `zh-Hant`, are not.
 */
export function sameLanguage(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.startsWith(`${y}-`) || y.startsWith(`${x}-`);
}

/**
 * Whether any part of the document carries a language the file declared for
 * it, as opposed to the catalog's alone. The reader's usual document language
 * applies only where none does (#57).
 */
export function declaresPartLanguages(document: AccessibleDocument): boolean {
  const inInline = (nodes: InlineNode[]): boolean =>
    nodes.some((node) =>
      node.type === 'text'
        ? node.declaredLanguage !== undefined
        : node.type === 'link' && inInline(node.content),
    );
  const inBlocks = (nodes: DocumentNode[]): boolean =>
    nodes.some((node) => {
      switch (node.type) {
        case 'heading':
        case 'paragraph':
        case 'unknown':
          return inInline(node.content);
        case 'list':
          return node.items.some((item) => inBlocks(item.blocks));
        case 'blockquote':
          return inBlocks(node.blocks);
        case 'table':
          return [...(node.header ? [node.header] : []), ...node.rows].some((row) =>
            row.cells.some((cell) => inInline(cell.content) || inBlocks(cell.blocks ?? [])),
          );
        default:
          return false;
      }
    });
  return document.pages.some((page) => inBlocks(page.nodes));
}

function declaresAnyLanguage(document: AccessibleDocument): boolean {
  const inInline = (nodes: InlineNode[]): boolean =>
    nodes.some((node) =>
      node.type === 'text'
        ? node.declaredLanguage !== undefined || node.language !== undefined
        : node.type === 'link' && inInline(node.content),
    );
  const inBlocks = (nodes: DocumentNode[]): boolean =>
    nodes.some((node) => {
      switch (node.type) {
        case 'heading':
        case 'paragraph':
        case 'unknown':
          return node.language !== undefined || inInline(node.content);
        case 'list':
          return node.items.some((item) => inBlocks(item.blocks));
        case 'blockquote':
          return inBlocks(node.blocks);
        case 'table':
          return [...(node.header ? [node.header] : []), ...node.rows].some((row) =>
            row.cells.some(
              (cell) =>
                cell.language !== undefined || inInline(cell.content) || inBlocks(cell.blocks ?? []),
            ),
          );
        default:
          return false;
      }
    });
  return document.pages.some((page) => inBlocks(page.nodes));
}
