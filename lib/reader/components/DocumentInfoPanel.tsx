import { useId, useState, type JSX, type ReactNode } from 'react';
import type { DocumentOrigin, PdfFileInfo } from '../../pdf/document-model';
import { useMessages, type Messages } from '../../i18n';
import { documentLanguageChoices } from '../../i18n/language-choices';
import type { LanguageSource } from '../../pdf/document-language';

/**
 * The document's own description of itself, plus where the structure on screen
 * came from.
 *
 * The structure row is the point of this panel. A reader has no other way to
 * tell whether they are looking at what the author marked up or at a guess
 * made from glyph positions, and that difference determines how much to trust
 * the headings and tables they are navigating.
 *
 * It is a `<details>`, so it is collapsed by default, operable from the
 * keyboard with no JavaScript behaviour of its own, and announced correctly
 * without any ARIA.
 */
export interface DocumentInfoPanelProps {
  info: PdfFileInfo | null;
  structureSource: DocumentOrigin | null;
  pageCount: number;
  /**
   * The language the Reader reads the document in, and where it came from
   * (`chooseDocumentLanguages`). The "Language" row is the catalog's own
   * value, so without this a reader hearing English from a PDF the panel calls
   * Japanese has no explanation (#50).
   */
  readingLanguage?: {
    language?: string;
    source?: LanguageSource;
    /** A chosen language is kept for the tab (session storage). False when it
     * could not be — no source address, or storage refused. */
    kept?: boolean;
  };
  /**
   * Chooses the language this document is read in; null goes back to the
   * automatic one (#57). Without it the row only reports.
   */
  onChooseLanguage?: (language: string | null) => void;
  /** The browser's languages, offered first. */
  browserLanguages?: readonly string[];
}

export function DocumentInfoPanel({
  info,
  structureSource,
  pageCount,
  readingLanguage,
  onChooseLanguage,
  browserLanguages = [],
}: DocumentInfoPanelProps): JSX.Element | null {
  const m = useMessages();
  const headingId = useId();
  const [open, setOpen] = useState(false);

  if (!info) return null;

  const rows: Array<[string, ReactNode]> = [];
  const add = (label: string, value: ReactNode) => {
    if (value !== undefined && value !== null && value !== '') rows.push([label, value]);
  };

  add(m.documentInfo.author, info.author);
  add(m.documentInfo.subject, info.subject);
  add(m.documentInfo.keywords, info.keywords);
  add(m.documentInfo.language, info.language ? languageLabel(info.language, m) : undefined);
  if (readingLanguage) {
    add(
      m.documentInfo.readingLanguage,
      <ReadingLanguage
        language={readingLanguage.language}
        source={readingLanguage.source}
        kept={readingLanguage.kept ?? false}
        browserLanguages={browserLanguages}
        {...(onChooseLanguage ? { onChoose: onChooseLanguage } : {})}
      />,
    );
  }
  add(m.documentInfo.pageCount, m.documentInfo.pages(pageCount));
  add(m.documentInfo.created, formatDate(info.createdAt, m));
  add(m.documentInfo.modified, formatDate(info.modifiedAt, m));
  add(m.documentInfo.creator, info.creator);
  add(m.documentInfo.producer, info.producer);
  add(m.documentInfo.pdfVersion, info.pdfVersion);
  add(
    m.documentInfo.tagged,
    info.isTagged ? m.documentInfo.taggedYes
    : info.hasStructureTree ? m.documentInfo.taggedUndeclared
    : m.documentInfo.taggedNo,
  );
  add(m.documentInfo.thisView, structureLabel(structureSource, m));

  if (rows.length === 0) return null;

  return (
    <details
      className="apv-docinfo"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary id={headingId}>{m.documentInfo.summary}</summary>
      <dl className="apv-docinfo__list">
        {rows.map(([label, value]) => (
          <div className="apv-docinfo__row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {/* Said whatever reading is on screen: it is a fact about the file, and
          the one a reader checking the PDF itself most needs. */}
      {!info.isTagged && info.hasStructureTree ? (
        <p className="apv-docinfo__note">{m.documentInfo.undeclaredNote}</p>
      ) : null}
      {/* Only for a PDF with no tags at all. Keyed on the reading alone, this
          told a reader who had switched a tagged PDF to the inferred reading
          that it had no tags. */}
      {structureSource === 'pdf-inspector' && !info.isTagged && !info.hasStructureTree ? (
        <p className="apv-docinfo__note">{m.documentInfo.untaggedNote}</p>
      ) : null}
      {structureSource === 'combined' ? (
        <p className="apv-docinfo__note">{m.documentInfo.combinedNote}</p>
      ) : null}
    </details>
  );
}

function structureLabel(source: DocumentOrigin | null, m: Messages): string | undefined {
  switch (source) {
    case 'combined':
    case 'tagged-pdf':
    case 'pdf-inspector':
    case 'ocr':
      return m.documentInfo.structure[source];
    default:
      return undefined;
  }
}

/** The document's language, named in the interface's language — not in its
 * own, which is the one thing the reader may not be able to read. */
/**
 * The language the document is read in, why, and — where the Reader allows it —
 * the control that changes it for this document.
 *
 * A native `<select>` with a visible label: the panel is read in order, and a
 * reader who has just heard Romanian read in an English voice should meet the
 * reason and the remedy together.
 */
function ReadingLanguage({
  language,
  source,
  kept,
  browserLanguages,
  onChoose,
}: {
  language: string | undefined;
  source: LanguageSource | undefined;
  kept: boolean;
  browserLanguages: readonly string[];
  onChoose?: (language: string | null) => void;
}): JSX.Element {
  const m = useMessages();
  const selectId = useId();
  const reasons = m.documentInfo.readingLanguageReason;
  const reason = !language || !source
    ? reasons.none
    : source === 'chosen'
      ? reasons.chosen(languageLabel(language, m), kept)
      : reasons[source](languageLabel(language, m));
  const choices = documentLanguageChoices(m.app.locale, browserLanguages, [language]);
  const chosen = source === 'chosen' && language ? language.split('-')[0]!.toLowerCase() : '';

  return (
    <>
      <span className="apv-docinfo__reason">{reason}</span>
      {onChoose ? (
        <span className="apv-docinfo__choose">
          <label htmlFor={selectId}>{m.documentInfo.readingLanguageChoose}</label>
          <select
            id={selectId}
            value={chosen}
            onChange={(event) => onChoose(event.currentTarget.value || null)}
          >
            <option value="">{m.documentInfo.readingLanguageAutomatic}</option>
            {choices.map((choice) => (
              <option key={choice.tag} value={choice.tag}>
                {choice.label}
              </option>
            ))}
          </select>
        </span>
      ) : null}
    </>
  );
}

function languageLabel(tag: string, m: Messages): string {
  try {
    const names = new Intl.DisplayNames([m.app.locale], { type: 'language' });
    const name = names.of(tag);
    return name && name !== tag ? `${name} (${tag})` : tag;
  } catch {
    return tag;
  }
}

function formatDate(iso: string | undefined, m: Messages): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;

  try {
    return new Intl.DateTimeFormat(m.app.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
