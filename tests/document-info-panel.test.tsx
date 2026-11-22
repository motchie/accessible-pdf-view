import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentOrigin, PdfFileInfo } from '../lib/pdf/document-model';
import type { Locale } from '../lib/i18n';
import { DocumentInfoPanel } from '../lib/reader/components/DocumentInfoPanel';
import { inLocale } from './helpers/messages';

/**
 * What the document information panel says about a PDF's structure tags.
 *
 * A tree without the Tagged PDF declaration is read, because its tags are the
 * author's structure — but the panel has to say the file does not conform,
 * since a reader checking the PDF itself would otherwise take the reading on
 * screen as evidence that it does.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DECLARED: PdfFileInfo = { isTagged: true, hasStructureTree: true };
const UNDECLARED: PdfFileInfo = { isTagged: false, hasStructureTree: true };
const UNTAGGED: PdfFileInfo = { isTagged: false, hasStructureTree: false };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(info: PdfFileInfo, structureSource: DocumentOrigin, locale: Locale = 'ja'): void {
  act(() =>
    root.render(
      inLocale(locale, <DocumentInfoPanel info={info} structureSource={structureSource} pageCount={1} />),
    ),
  );
}

const row = (label: string) =>
  [...container.querySelectorAll('.apv-docinfo__row')]
    .find((element) => element.querySelector('dt')?.textContent === label)
    ?.querySelector('dd')?.textContent;
const notes = () => [...container.querySelectorAll('.apv-docinfo__note')].map((p) => p.textContent);

describe('an undeclared structure tree', () => {
  it('is reported as tags without the declaration, and as not conforming', () => {
    mount(UNDECLARED, 'tagged-pdf');
    expect(row('構造タグ')).toBe('あり（Tagged PDF の宣言なし）');
    expect(notes()).toEqual([
      'この PDF には構造タグがありますが、Tagged PDF であるという宣言（/MarkInfo の /Marked true）がありません。規格（ISO 32000、PDF/UA）が求める宣言がないため、ほかのビューアーや支援技術ではタグが使われないことがあります。',
    ]);
  });

  it('says the same in English', () => {
    mount(UNDECLARED, 'tagged-pdf', 'en');
    expect(row('Structure tags')).toBe('Yes, but not declared as Tagged PDF');
    expect(notes()).toEqual([
      'This PDF has structure tags, but does not declare itself Tagged PDF (/MarkInfo with /Marked true), as ISO 32000 and PDF/UA require. Other viewers and assistive technology may not use its tags.',
    ]);
  });

  it('keeps the note, and says nothing of missing tags, on the inferred reading', () => {
    mount(UNDECLARED, 'pdf-inspector');
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toContain('宣言');
  });
});

describe('the other two cases', () => {
  it('adds no note for a declared Tagged PDF, on either reading', () => {
    mount(DECLARED, 'tagged-pdf');
    expect(row('構造タグ')).toBe('あり (Tagged PDF)');
    expect(notes()).toEqual([]);

    // Switched to the inferred reading, it still has tags; saying otherwise
    // was the old behaviour.
    mount(DECLARED, 'pdf-inspector');
    expect(notes()).toEqual([]);
  });

  it('says an untagged PDF has no tags', () => {
    mount(UNTAGGED, 'pdf-inspector');
    expect(row('構造タグ')).toBe('なし');
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toContain('構造タグが含まれていない');
  });
});

/**
 * The "Language" row is the catalog's own /Lang. When the Reader reads the
 * document in the language every passage in its tags declares instead (#49),
 * the panel says so and why, or a reader hearing English from a PDF the panel
 * calls Japanese has no explanation.
 */
describe('the language the Reader reads in', () => {
  function mountWith(languageFromTags: string | undefined, locale: Locale): void {
    act(() =>
      root.render(
        inLocale(
          locale,
          <DocumentInfoPanel
            info={{ ...DECLARED, language: 'ja' }}
            structureSource="tagged-pdf"
            pageCount={1}
            {...(languageFromTags ? { languageFromTags } : {})}
          />,
        ),
      ),
    );
  }

  it('is shown beside the catalog’s, with the reason, when the tags decided it', () => {
    mountWith('en', 'ja');
    expect(row('言語')).toBe('日本語 (ja)');
    expect(row('読み上げの言語')).toBe(
      '英語 (en)（構造タグで、本文のすべての部分がこの言語を宣言しているため）',
    );

    mountWith('en', 'en');
    expect(row('Language')).toBe('Japanese (ja)');
    expect(row('Read as')).toBe(
      'English (en): every passage the structure tags cover declares this language',
    );
  });

  it('is not shown when the Reader uses the catalog’s', () => {
    mountWith(undefined, 'ja');
    expect(row('読み上げの言語')).toBeUndefined();
  });
});
