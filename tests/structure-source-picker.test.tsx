import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocumentOrigin } from '../lib/pdf/document-model';
import { StructureSourcePicker } from '../lib/reader/components/StructureSourcePicker';
import { inLocale } from './helpers/messages';

/**
 * The control that says which reading of the PDF is on screen.
 *
 * Two of these tests are really about honesty rather than about the widget: it
 * must not appear when there is nothing to choose, and it must say what the
 * user actually loses by choosing the inferred reading. Both are the kind of
 * thing that survives a refactor only if something checks.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BOTH: DocumentOrigin[] = ['tagged-pdf', 'pdf-inspector'];

let container: HTMLDivElement;
let root: Root;
let picked: DocumentOrigin[];

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  picked = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(overrides: Partial<Parameters<typeof StructureSourcePicker>[0]> = {}): void {
  act(() => {
    root.render(
      inLocale(
        'ja',
        <StructureSourcePicker
          sources={BOTH}
          active="tagged-pdf"
          preparing={null}
          error={null}
          onSelect={(origin) => picked.push(origin)}
          {...overrides}
        />,
      ),
    );
  });
}

function radios(): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
}

describe('the structure source picker', () => {
  /**
   * An untagged PDF has been read once. Offering a choice between one thing and
   * nothing would suggest the Reader is withholding a better reading it has.
   */
  it('does not appear when there is only one reading', () => {
    mount({ sources: ['pdf-inspector'] });
    expect(container.textContent).toBe('');
    expect(container.querySelector('input')).toBeNull();
  });

  it('is a native radio group with a legend', () => {
    mount();
    const fieldset = container.querySelector('fieldset')!;
    const legend = fieldset.querySelector('legend')!;

    expect(legend.textContent).toBe('構造の読み取り方');
    expect(radios()).toHaveLength(2);
    // One name, so they are one group and the arrow keys move between them.
    expect(new Set(radios().map((radio) => radio.name)).size).toBe(1);
    expect(radios().map((radio) => radio.checked)).toEqual([true, false]);
  });

  /** A tagged document with no headings of its own has three readings. */
  it('offers the combined reading first when the document has one', () => {
    mount({ sources: ['combined', 'tagged-pdf', 'pdf-inspector'], active: 'combined' });
    expect(radios()).toHaveLength(3);
    expect(radios().map((radio) => radio.checked)).toEqual([true, false, false]);
    expect(container.textContent).toContain('構造タグ＋推測した見出し');
  });

  /**
   * The count is the concrete difference between the readings, and the thing
   * a reader can weigh: five headings that were inferred, against none.
   */
  it('says how many headings each reading offers, when told', () => {
    mount({
      sources: ['combined', 'tagged-pdf', 'pdf-inspector'],
      active: 'combined',
      headingCounts: { combined: 5, 'tagged-pdf': 0, 'pdf-inspector': 6 },
    });
    const details = [...container.querySelectorAll('.apv-picker__detail')].map((el) => el.textContent);
    expect(details[0]).toContain('見出し 5 件');
    expect(details[1]).toContain('見出し 0 件');
    expect(details[2]).toContain('見出し 6 件');
  });

  it('follows the active reading rather than its own state', () => {
    mount({ active: 'pdf-inspector' });
    expect(radios().map((radio) => radio.checked)).toEqual([false, true]);
  });

  it('reports a choice without switching by itself', () => {
    mount();
    act(() => {
      radios()[1]!.click();
    });

    expect(picked).toEqual(['pdf-inspector']);
    // Still showing the tagged reading: the hook decides when it has changed,
    // and it has to prepare the other document first.
    expect(radios().map((radio) => radio.checked)).toEqual([true, false]);
  });

  /**
   * The whole point of naming the readings. "Layout" tells a reader nothing
   * about what they are giving up; the alt text does.
   */
  it('says what the inferred reading cannot give', () => {
    mount();
    const text = container.textContent ?? '';

    expect(text).toContain('作成者が指定した構造');
    expect(text).toContain('代替テキストは読み取れず');
    // And that work done on one reading does not follow the user to the other.
    expect(text).toContain('適用した読み取り方にのみ残ります');
  });

  it('announces a preparation in a region that was already there', () => {
    mount();
    const status = container.querySelector('[role="status"]')!;
    // Present and empty before anything happens: a live region inserted at the
    // same moment as its message is not reliably announced.
    expect(status.textContent).toBe('');

    mount({ preparing: 'pdf-inspector' });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'レイアウトからの推測',
    );
  });

  it('reports a failed switch without taking the reading away', () => {
    mount({ error: '準備できませんでした' });
    const alert = container.querySelector('[role="alert"]')!;

    expect(alert.textContent).toContain('読み直せませんでした');
    // The options are still there, and the current reading is still selected.
    expect(radios()).toHaveLength(2);
    expect(radios()[0]!.checked).toBe(true);
  });
});
