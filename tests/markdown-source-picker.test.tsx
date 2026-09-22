import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownSourcePicker } from '../lib/reader/components/MarkdownSourcePicker';
import { ja } from '../lib/i18n/ja';
import { inLocale } from './helpers/messages';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let chosen: string[];

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  chosen = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(overrides: Partial<Parameters<typeof MarkdownSourcePicker>[0]> = {}): void {
  act(() => {
    root.render(
      inLocale(
        'ja',
        <MarkdownSourcePicker
          value="document"
          onChange={(source) => chosen.push(source)}
          structureSource="tagged-pdf"
          rawUnavailable={false}
          {...overrides}
        />,
      ),
    );
  });
}

describe('the Markdown source picker', () => {
  /**
   * The two questions in the header are neighbours and easy to confuse: which
   * reading of the PDF, and whose Markdown. Naming the reading inside the first
   * option is what keeps them apart without the reader having to remember.
   */
  it('names the reading the Reader is currently showing', () => {
    mount();
    expect(container.textContent).toContain(ja.structure.sources['tagged-pdf'].label);

    mount({ structureSource: 'pdf-inspector' });
    expect(container.textContent).toContain(ja.structure.sources['pdf-inspector'].label);
  });

  it('still names itself when no reading is known yet', () => {
    mount({ structureSource: null });
    expect(container.querySelectorAll('input')).toHaveLength(2);
    expect(container.textContent).toContain('リーダーと同じ内容');
  });

  it('reports a choice rather than switching itself', () => {
    mount();
    const raw = container.querySelectorAll<HTMLInputElement>('input')[1]!;
    act(() => raw.click());

    expect(chosen).toEqual(['raw']);
    // Controlled: still showing what it was told to show.
    expect(container.querySelectorAll<HTMLInputElement>('input')[0]!.checked).toBe(true);
  });

  /**
   * A PDF with no extractable text produces no Markdown. The option stays
   * visible and disabled: removing it would leave no explanation for why the
   * choice a reader made yesterday is gone today.
   */
  it('disables the raw output when there is none, without hiding it', () => {
    mount({ rawUnavailable: true });
    const inputs = container.querySelectorAll<HTMLInputElement>('input');

    expect(inputs).toHaveLength(2);
    expect(inputs[1]!.disabled).toBe(true);
    expect(inputs[0]!.disabled).toBe(false);
  });
});
