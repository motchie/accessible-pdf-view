import type { Messages } from '../i18n';
import type { ViewMode } from './components/ReaderToolbar';

import type { AnalysisPhase } from './use-pdf-analysis';

/**
 * What the browser tab is called.
 *
 * `事業報告（リーダー） — Accessible PDF View`: the document, a note about it,
 * then the extension.
 *
 * The document comes first because it is what tells one tab from another, and a
 * tab title truncates from the end — so the part that survives a narrow tab is
 * the part that identifies it. The note in brackets is the state you come back
 * to: which view it was left in once the document is open, and before that,
 * what is still being done to it. A tab title is the one part of the Reader
 * that is read from outside it — cycling tabs with a screen reader, or looking
 * along a strip of them — and a tab that spends thirty seconds saying only the
 * extension's name is a tab that has gone quiet while it works.
 *
 * The brackets come from the catalogue rather than from here, because they are
 * punctuation and punctuation is not the same in both languages. So do the view
 * names, which are katakana in Japanese.
 *
 * `idle` is the one state with nothing to say: no document has been named and
 * nothing has started. Everything else names the document when it has one — the
 * file name is known from the URL long before the analysis finishes — and drops
 * the brackets when it does not, rather than showing an empty pair.
 */
export function readerTabTitle(
  m: Messages,
  state: {
    phase: AnalysisPhase;
    view: ViewMode;
    /** The document's own title, or the file name, or null when neither. */
    name: string | null;
  },
): string {
  switch (state.phase) {
    case 'idle':
      return m.app.name;
    case 'fetching':
      return titled(m, state.name, m.tabTitle.fetching);
    case 'analyzing':
      return titled(m, state.name, m.tabTitle.analyzing);
    case 'error':
      return titled(m, state.name, m.tabTitle.failed);
    case 'ready':
      return titled(m, state.name, m.views[state.view].label);
  }
}

function titled(m: Messages, name: string | null, note: string): string {
  return `${name ? m.app.documentNote(name, note) : note} — ${m.app.name}`;
}
