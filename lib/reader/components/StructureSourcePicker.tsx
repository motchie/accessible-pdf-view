import { useId, type JSX } from 'react';
import type { DocumentOrigin } from '../../pdf/document-model';
import { useMessages } from '../../i18n';

/**
 * Choosing which reading of the PDF the Reader shows.
 *
 * A tagged PDF has been read twice: once from the author's structure tree, once
 * by inferring structure from where the ink landed. The tag tree is the better
 * answer and it is not always the right one — tags can be wrong, stale, or
 * applied by a tool that guessed — and the only way to find out is to read the
 * document both ways.
 *
 * It appears only when there genuinely are two readings, which means: tagged
 * PDFs. For an untagged file there is one producer and nothing to choose, and a
 * control offering a choice that does not exist would be worse than no control.
 *
 * It sits with the document's own information, above the rule that separates
 * the header from the document — because that is what it is: a statement about
 * the whole document, not part of it. Which reading is on screen belongs beside
 * the title and the page count, not inside the text it changes.
 *
 * The switch is a radio group, not the toolbar's view dropdown. The dropdown
 * picks *what to look at* — the same document as HTML, as pages, as Markdown.
 * This picks *which reading* of the document all of those then show, and
 * folding two different questions into one control would make both harder to
 * answer.
 */
export interface StructureSourcePickerProps {
  sources: ReadonlyArray<DocumentOrigin>;
  active: DocumentOrigin | null;
  /** Set while a reading is being prepared for its first showing. */
  preparing: DocumentOrigin | null;
  /** A preparation that failed. The reading on screen is unaffected. */
  error: string | null;
  /**
   * How many headings each reading offers, when known. Shown with each
   * option, because it is the concrete thing the readings differ in on the
   * documents that have more than one — and the number is what lets a reader
   * weigh "the author's structure" against "the author's structure plus five
   * headings that were inferred".
   */
  headingCounts?: Partial<Record<DocumentOrigin, number>>;
  onSelect: (origin: DocumentOrigin) => void;
}

export function StructureSourcePicker({
  sources,
  active,
  preparing,
  error,
  headingCounts,
  onSelect,
}: StructureSourcePickerProps): JSX.Element | null {
  const m = useMessages();
  const groupName = useId();

  // One reading is not a choice.
  if (sources.length < 2) return null;

  return (
    <section className="apv-picker" aria-labelledby={`${groupName}-heading`}>
      <fieldset className="apv-picker__choices">
        <legend id={`${groupName}-heading`}>{m.structure.legend}</legend>

        {sources.map((origin) => (
          <label key={origin} className="apv-picker__option">
            <input
              type="radio"
              name={groupName}
              checked={active === origin}
              onChange={() => onSelect(origin)}
            />
            <span className="apv-picker__label">{m.structure.sources[origin].label}</span>
            <span className="apv-picker__detail">
              {m.structure.sources[origin].detail}
              {headingCounts?.[origin] !== undefined
                ? m.structure.headingCount(headingCounts[origin]!)
                : ''}
            </span>
          </label>
        ))}
      </fieldset>

      {/* Kept in the DOM at all times so the announcement is not lost to a
          freshly-inserted live region. */}
      <p role="status" className="apv-picker__status">
        {preparing ? m.structure.reloading(m.structure.sources[preparing].label) : ''}
      </p>

      {error ? (
        <p role="alert" className="apv-picker__error">
          {m.structure.reloadFailed(error)}
        </p>
      ) : null}

      <p className="apv-picker__note">{m.structure.staysWithReading}</p>
    </section>
  );
}
