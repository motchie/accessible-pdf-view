import { describe, expect, it } from 'vitest';
import type { DocumentOrigin } from '../lib/pdf/document-model';
import {
  STRUCTURE_ORDER,
  initialStructureSource,
} from '../lib/reader/structure-source';
import { en } from '../lib/i18n/en';
import { ja } from '../lib/i18n/ja';

describe('choosing the reading a document opens with', () => {
  it('honours the setting when the document offers it', () => {
    const both: DocumentOrigin[] = ['tagged-pdf', 'pdf-inspector'];
    expect(initialStructureSource(both, 'pdf-inspector')).toBe('pdf-inspector');
    expect(initialStructureSource(both, 'tagged-pdf')).toBe('tagged-pdf');
  });

  /**
   * An untagged PDF has one reading. A preference for the other one cannot be
   * honoured, and must not turn into an empty Reader.
   */
  it('falls back to what the document actually produced', () => {
    expect(initialStructureSource(['pdf-inspector'], 'tagged-pdf')).toBe('pdf-inspector');
    expect(initialStructureSource([], 'tagged-pdf')).toBeNull();
  });

  /**
   * The default is the combined reading, and most documents do not have one:
   * the author used heading styles, or nothing could be verified. The
   * preference then has to fall to the author's own answer, never to
   * inference — which is what the offered order guarantees.
   */
  it('falls from the combined reading to the author’s answer, not to inference', () => {
    expect(initialStructureSource(['tagged-pdf', 'pdf-inspector'], 'combined')).toBe('tagged-pdf');
    expect(initialStructureSource(['combined', 'tagged-pdf', 'pdf-inspector'], 'combined')).toBe('combined');
    expect(initialStructureSource(['combined', 'tagged-pdf', 'pdf-inspector'], 'tagged-pdf')).toBe('tagged-pdf');
    expect(initialStructureSource(['pdf-inspector'], 'combined')).toBe('pdf-inspector');
  });
});

describe('the words for each reading', () => {
  it('offers the author’s answer, filled in, first — and the author’s answer alone next', () => {
    expect(STRUCTURE_ORDER).toEqual(['combined', 'tagged-pdf', 'pdf-inspector']);
  });

  /**
   * These strings are shown in three places — the picker, the Markdown picker
   * and the settings panel. The point of the module is that they are the same
   * string, so a reader who sets a default meets the same words on the page.
   */
  it('says what each reading costs, not just what it is called', () => {
    for (const origin of STRUCTURE_ORDER) {
      expect(ja.structure.sources[origin].label.length).toBeGreaterThan(0);
      expect(ja.structure.sources[origin].detail.length).toBeGreaterThan(10);
      // English is the base language, not an afterthought: a reading offered
      // without a description in one locale is offered without it in that
      // locale only, which is the drift the catalogue exists to prevent.
      expect(en.structure.sources[origin].label.length).toBeGreaterThan(0);
      expect(en.structure.sources[origin].detail.length).toBeGreaterThan(10);
    }
    expect(ja.structure.sources['pdf-inspector'].detail).toContain('代替テキストは読み取れず');
    // The combined reading has to say what it adds and what it keeps.
    expect(ja.structure.sources.combined.detail).toContain('推測した見出し');
    expect(ja.structure.sources.combined.detail).toContain('見出し以外は構造タグのまま');
  });
});
