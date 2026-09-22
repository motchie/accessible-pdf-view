import { useId, type JSX } from 'react';
import type { DocumentOrigin } from '../../pdf/document-model';
import { useMessages } from '../../i18n';

/**
 * Which Markdown the Markdown view shows.
 *
 * It sits beside the structure picker, above the rule, and is built the same
 * way on purpose. The two questions are next to each other and easy to confuse
 * — *which reading of the PDF* and *whose Markdown* — so the answer to the
 * first is quoted inside the answer to the second: "The same as the Reader"
 * names the
 * reading currently on screen rather than leaving the reader to remember it.
 *
 * Lifted out of the Markdown view itself so it can live in the header. The view
 * is now told which source to render instead of deciding for itself, which also
 * means the choice survives switching away to the Reader and back.
 */
export type MarkdownSource = 'document' | 'raw';

export interface MarkdownSourcePickerProps {
  value: MarkdownSource;
  onChange: (source: MarkdownSource) => void;
  /** Which reading the Reader is showing, named in the first option. */
  structureSource: DocumentOrigin | null;
  /** pdf-inspector produced no Markdown for this PDF. */
  rawUnavailable: boolean;
}

export function MarkdownSourcePicker({
  value,
  onChange,
  structureSource,
  rawUnavailable,
}: MarkdownSourcePickerProps): JSX.Element {
  const groupName = useId();
  const m = useMessages();
  const reading = structureSource ? m.structure.sources[structureSource].label : null;

  return (
    <section className="apv-picker" aria-labelledby={`${groupName}-heading`}>
      <fieldset className="apv-picker__choices">
        <legend id={`${groupName}-heading`}>{m.markdown.legend}</legend>

        <label className="apv-picker__option">
          <input
            type="radio"
            name={groupName}
            checked={value === 'document'}
            onChange={() => onChange('document')}
          />
          <span className="apv-picker__label">{m.markdown.sameAsReader}</span>
          <span className="apv-picker__detail">
            {reading
              ? m.markdown.sameAsReaderDetail(reading)
              : m.markdown.sameAsReaderDetailPlain}{' '}
            {m.markdown.generatedAreMarked}
          </span>
        </label>

        <label className="apv-picker__option">
          <input
            type="radio"
            name={groupName}
            checked={value === 'raw'}
            onChange={() => onChange('raw')}
            disabled={rawUnavailable}
          />
          <span className="apv-picker__label">{m.markdown.rawOutput}</span>
          <span className="apv-picker__detail">
            {m.markdown.rawOutputDetail}
          </span>
        </label>
      </fieldset>
    </section>
  );
}
