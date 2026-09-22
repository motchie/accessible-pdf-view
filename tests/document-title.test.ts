import { describe, expect, it } from 'vitest';
import { readerTabTitle } from '../lib/reader/document-title';
import { en } from '../lib/i18n/en';
import { ja } from '../lib/i18n/ja';

/**
 * The tab title is the only part of the Reader that is read from outside it —
 * by someone cycling tabs, or looking along a strip of them. So it carries the
 * two things that tell one Reader tab from another: which document, and what is
 * happening to it or which view it was left in.
 */
describe('the tab title', () => {
  const title = (
    phase: Parameters<typeof readerTabTitle>[1]['phase'],
    name: string | null = 'report.pdf',
    view: Parameters<typeof readerTabTitle>[1]['view'] = 'reader',
  ) => readerTabTitle(ja, { phase, view, name });

  it('names the document, the view it is in, then the extension', () => {
    expect(readerTabTitle(ja, { phase: 'ready', view: 'reader', name: '事業報告' })).toBe(
      '事業報告（リーダー） — Accessible PDF View',
    );
  });

  it('follows the view switch, which is the state nothing else reports', () => {
    expect(title('ready', 'report.pdf', 'original')).toBe(
      'report.pdf（オリジナル） — Accessible PDF View',
    );
    expect(title('ready', 'report.pdf', 'markdown')).toBe(
      'report.pdf（マークダウン） — Accessible PDF View',
    );
  });

  /**
   * The analysis takes seconds on a long document and reports itself in a live
   * region that only reaches whoever is on the page. A tab left to work on its
   * own used to say the extension's name and nothing else, which is
   * indistinguishable from a tab that has finished.
   */
  it('says what is still being done, before there is a view to name', () => {
    expect(title('fetching')).toBe('report.pdf（取得しています…） — Accessible PDF View');
    expect(title('analyzing')).toBe('report.pdf（解析しています…） — Accessible PDF View');
  });

  /** A failure is a state worth coming back to a tab for, too. */
  it('says when the document could not be read', () => {
    expect(title('error')).toBe('report.pdf（読み込めませんでした） — Accessible PDF View');
  });

  /** Nothing has been named and nothing has started. The one state with
   * nothing to say about itself. */
  it('carries the extension alone before anything begins', () => {
    expect(title('idle')).toBe('Accessible PDF View');
  });

  /**
   * A PDF that declares no title, opened from a URL with no file name in it.
   * Empty brackets would be worse than none, and repeating the extension's name
   * would read as "Accessible PDF View（リーダー） — Accessible PDF View".
   */
  it('gives the note alone when there is no document name to bracket', () => {
    expect(title('ready', null)).toBe('リーダー — Accessible PDF View');
    expect(title('analyzing', null)).toBe('解析しています… — Accessible PDF View');
  });

  /**
   * Neither the words nor the brackets survive the change of language:
   * Japanese names the views in katakana, so that a screen reader reads them as
   * Japanese rather than switching voice for one word, and sets the brackets
   * full width. Both come from the catalogue for that reason.
   */
  it('words and brackets it the way the interface language does', () => {
    expect(readerTabTitle(en, { phase: 'ready', view: 'original', name: 'report.pdf' })).toBe(
      'report.pdf (Original) — Accessible PDF View',
    );
    expect(readerTabTitle(en, { phase: 'analyzing', view: 'reader', name: 'report.pdf' })).toBe(
      'report.pdf (Analysing…) — Accessible PDF View',
    );
  });
});
