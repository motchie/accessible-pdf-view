import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { AccessibleDocument } from '../../pdf/document-model';
import { documentToMarkdown } from '../markdown-serializer';
import { useMessages } from '../../i18n';
import type { MarkdownSource } from './MarkdownSourcePicker';

/**
 * Markdown mode: the document as text, raw and copyable.
 *
 * Two sources, because they answer different questions and conflating them
 * would misrepresent one of them:
 *
 *   **The same as the Reader** — the Document Model serialised. This is what
 *   is on
 *   screen: whichever reading of the PDF is selected, and any figure
 *   descriptions that have been generated.
 *
 *   **pdf-inspector's raw output** — the parser's own output, untouched.
 *   Still the
 *   right answer for "what did the parser make of this file", and the only one
 *   that is a faithful record of it.
 *
 * The choice itself is `MarkdownSourcePicker`, which lives in the header beside
 * the structure picker — the two questions are neighbours and are asked in the
 * same place. This view is told the answer.
 *
 * Shown as text, never rendered as markup. The `<pre>` is focusable because it
 * scrolls, and the copy result is announced rather than signalled by colour.
 */
export interface MarkdownViewProps {
  document: AccessibleDocument | null;
  /** pdf-inspector's Markdown, exactly as produced. */
  rawMarkdown: string | null;
  /** Chosen in the header, not here. */
  source: MarkdownSource;
}

export function MarkdownView({ document, rawMarkdown, source }: MarkdownViewProps): JSX.Element {
  const m = useMessages();
  const [copyStatus, setCopyStatus] = useState('');
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  const documentMarkdown = useMemo(
    () => (document ? documentToMarkdown(document, m) : null),
    [document],
  );

  const text = source === 'document' ? documentMarkdown : rawMarkdown;

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(m.markdown.copied);
    } catch {
      setCopyStatus(m.markdown.copyFailed);
    }
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setCopyStatus(''), 5000);
  }

  return (
    <div className="apv-markdown">
      <div className="apv-markdown__toolbar">
        <button type="button" onClick={copy} disabled={!text}>
          {m.markdown.copy}
        </button>
        {/* Kept in the DOM at all times so the announcement is not lost to a
            freshly-inserted live region. */}
        <span role="status" className="apv-markdown__status">
          {copyStatus}
        </span>
      </div>

      {text === null ? (
        <p className="apv-notice">
          {source === 'raw'
            ? m.markdown.emptyNoText
            : m.markdown.empty}
        </p>
      ) : (
        <pre className="apv-markdown__source" tabIndex={0}>
          {text}
        </pre>
      )}
    </div>
  );
}
