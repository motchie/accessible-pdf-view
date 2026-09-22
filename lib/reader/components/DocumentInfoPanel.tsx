import { useId, useState, type JSX, type ReactNode } from 'react';
import type { DocumentOrigin, PdfFileInfo } from '../../pdf/document-model';
import { useMessages, type Messages } from '../../i18n';

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
}

export function DocumentInfoPanel({
  info,
  structureSource,
  pageCount,
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
  add(m.documentInfo.pageCount, m.documentInfo.pages(pageCount));
  add(m.documentInfo.created, formatDate(info.createdAt, m));
  add(m.documentInfo.modified, formatDate(info.modifiedAt, m));
  add(m.documentInfo.creator, info.creator);
  add(m.documentInfo.producer, info.producer);
  add(m.documentInfo.pdfVersion, info.pdfVersion);
  add(m.documentInfo.tagged, info.isTagged ? m.documentInfo.taggedYes : m.documentInfo.taggedNo);
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
      {structureSource === 'pdf-inspector' ? (
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
