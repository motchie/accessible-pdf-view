import { afterEach, describe, expect, it } from 'vitest';
import { domToOutline } from './helpers/dom-outline';
import { serializeOutline } from './helpers/outline';

/**
 * Rendered DOM -> outline, on hand-written markup.
 *
 * The end-to-end harness checks this against the Reader's own output; these
 * pin the rules themselves, including the places where the outline knowingly
 * departs from what `dom-accessibility-api` returns, so a change to either is
 * a visible decision rather than a drift.
 */
let container: HTMLElement;

function outlineOf(html: string): string {
  container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  return serializeOutline(domToOutline(container, { document: false }));
}

afterEach(() => {
  container?.remove();
  document.title = '';
  document.documentElement.removeAttribute('lang');
});

describe('domToOutline', () => {
  it('hoists generic wrappers and keeps headings with their level', () => {
    expect(outlineOf('<div><div><h2>Section</h2></div><span><h3>Sub</h3></span></div>')).toBe(
      'heading level=2 "Section"\nheading level=3 "Sub"\n',
    );
  });

  it('keeps a paragraph\'s whole sentence and lists its link as a child', () => {
    expect(
      outlineOf(
        '<p>See <a href="https://example.org">the <strong>site</strong><span class="hidden">(new tab)</span></a> for more.</p>',
      ),
    ).toBe(
      'paragraph "See the site(new tab) for more."\n' +
        '  link href=https://example.org "the site(new tab)"\n',
    );
  });

  it('leaves hidden content out, whichever way it is hidden', () => {
    expect(
      outlineOf(
        '<p>shown</p><p hidden>attribute</p><p aria-hidden="true">aria</p>' +
          '<div style="display: none"><p>display</p></div><p style="visibility: hidden">visibility</p>' +
          '<p>text <span aria-hidden="true">not this</span>only</p>',
      ),
    ).toBe('paragraph "shown"\nparagraph "text only"\n');
  });

  it('marks <ol> as ordered and gives a list item no name when a paragraph holds its text', () => {
    expect(outlineOf('<ol><li><p>Open</p><ul><li>Nested</li></ul></li></ol>')).toBe(
      'list ordered\n' +
        '  listitem\n' +
        '    paragraph "Open"\n' +
        '    list\n' +
        '      listitem "Nested"\n',
    );
  });

  it('reads tables without row groups, telling row headers from column headers', () => {
    expect(
      outlineOf(
        '<div role="region" aria-label="Table"><table><thead><tr><th scope="col">Name</th><th scope="col">Value</th></tr></thead>' +
          '<tbody><tr><th scope="row">A</th><td>1</td></tr></tbody></table></div>',
      ),
    ).toBe(
      'region "Table"\n' +
        '  table\n' +
        '    row\n' +
        '      columnheader "Name"\n' +
        '      columnheader "Value"\n' +
        '    row\n' +
        '      rowheader "A"\n' +
        '      cell "1"\n',
    );
  });

  it('names images by alt, drops decorative ones, and names figures by caption only', () => {
    expect(
      outlineOf(
        '<figure><img src="a.png" alt="A chart"></figure>' +
          '<figure><img src="b.png" alt=""></figure>' +
          '<figure><img src="c.png" alt="C"><figcaption>Figure 1</figcaption></figure>',
      ),
    ).toBe('figure\n  img "A chart"\nfigure\nfigure "Figure 1"\n  img "C"\n');
  });

  it('treats a section as a region only when it is named', () => {
    expect(outlineOf('<section><p>a</p></section><section aria-label="Reader"><p>b</p></section>')).toBe(
      'paragraph "a"\nregion "Reader"\n  paragraph "b"\n',
    );
  });

  it('keeps lang where an element declares it', () => {
    expect(outlineOf('<article lang="ja"><p lang="en">Hello</p></article>')).toBe(
      'article lang=ja\n  paragraph lang=en "Hello"\n',
    );
  });

  it('collapses HTML whitespace but keeps the ideographic space, and normalises to NFC', () => {
    expect(outlineOf('<p>  が\n  一　二<br>三  </p>')).toBe('paragraph "が 一　二 三"\n');
  });

  it('wraps the result in a document node with the page\'s lang and title', () => {
    document.title = 'Report（リーダー）';
    document.documentElement.lang = 'ja';
    container = document.createElement('div');
    container.innerHTML = '<h1>Report</h1>';
    document.body.append(container);
    expect(serializeOutline(domToOutline(container))).toBe(
      'document lang=ja title=Report（リーダー）\n  heading level=1 "Report"\n',
    );
  });
});
