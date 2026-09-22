import { describe, expect, it } from 'vitest';
import type { AccessibleDocument, DocumentNode, FigureNode } from '../lib/pdf/document-model';
import { documentToMarkdown } from '../lib/reader/markdown-serializer';
import { ja } from '../lib/i18n/ja';

/** Japanese, because the assertions here are about the provenance label the
 * Markdown carries out of the extension, and that is the wording they were
 * written against. */
const toMarkdown = (
  document: Parameters<typeof documentToMarkdown>[0],
  options?: Parameters<typeof documentToMarkdown>[2],
) => documentToMarkdown(document, ja, options);

/**
 * The Markdown view is the copyable artefact — text leaves the extension here
 * and lands somewhere this tool can no longer annotate it. So the rule that
 * governs the Reader governs this too: a generated description must not be
 * copyable as though the author had written it.
 */
function documentWith(nodes: DocumentNode[], title?: string): AccessibleDocument {
  return {
    metadata: {
      sourceUrl: null,
      pageCount: 1,
      producedBy: ['tagged-pdf'],
      ...(title ? { title } : {}),
    },
    pages: [{ pageNumber: 1, origin: 'tagged-pdf', status: 'available', nodes }],
  };
}

function figure(overrides: Partial<FigureNode> = {}): FigureNode {
  return { type: 'figure', status: 'missing-alt', ...overrides };
}

describe('documentToMarkdown', () => {
  it('writes headings below the title, matching the Reader', () => {
    const markdown = toMarkdown(
      documentWith(
        [{ type: 'heading', level: 1, content: [{ type: 'text', text: '第一の見出し' }] }],
        '文書のタイトル',
      ),
    );

    expect(markdown).toContain('# 文書のタイトル');
    expect(markdown).toContain('## 第一の見出し');
  });

  it('marks a generated description as generated, so a copy cannot pass as the author', () => {
    const markdown = toMarkdown(
      documentWith([
        figure({
          alternativeText: '生成された説明',
          alternativeTextSource: 'generated',
          status: 'available',
        }),
      ]),
    );

    expect(markdown).toContain(
      '![画像（AIによる自動生成の説明）: 生成された説明](image)',
    );
  });

  it("writes the author's own alternative text plainly", () => {
    const markdown = toMarkdown(
      documentWith([
        figure({
          alternativeText: '作成者が書いた説明',
          alternativeTextSource: 'author',
          status: 'available',
        }),
      ]),
    );

    expect(markdown).toContain('![作成者が書いた説明](image)');
    expect(markdown).not.toContain('自動生成');
  });

  it('says so when a figure was never described', () => {
    const markdown = toMarkdown(documentWith([figure()]));
    expect(markdown).toContain('代替テキストを取得できませんでした');
  });

  it('serialises a table, including a figure inside a cell', () => {
    const markdown = toMarkdown(
      documentWith([
        {
          type: 'table',
          header: {
            cells: [
              { header: true, content: [{ type: 'text', text: '列見出し一' }] },
              { header: true, content: [{ type: 'text', text: '列見出し二' }] },
            ],
          },
          rows: [
            {
              cells: [
                { header: true, content: [{ type: 'text', text: '行見出し' }] },
                {
                  header: false,
                  content: [{ type: 'text', text: 'セル内の見出し' }],
                  blocks: [
                    figure({
                      alternativeText: 'セル内の画像',
                      alternativeTextSource: 'generated',
                      status: 'available',
                    }),
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );

    expect(markdown).toContain('| 列見出し一 | 列見出し二 |');
    expect(markdown).toContain('| --- | --- |');
    // The figure travels with the cell rather than being dropped.
    expect(markdown).toContain('セル内の見出し');
    expect(markdown).toContain('自動生成の説明）: セル内の画像');
  });

  it('escapes a pipe so it cannot break the row it sits in', () => {
    const markdown = toMarkdown(
      documentWith([
        {
          type: 'table',
          rows: [
            {
              cells: [{ header: false, content: [{ type: 'text', text: 'a|b' }] }],
            },
          ],
        },
      ]),
    );

    expect(markdown).toContain('a\\|b');
  });

  it('keeps ordered lists numbered from where the document starts them', () => {
    const markdown = toMarkdown(
      documentWith([
        {
          type: 'list',
          ordered: true,
          start: 2,
          items: [
            { blocks: [{ type: 'paragraph', content: [{ type: 'text', text: '二つ目の項目' }] }] },
            { blocks: [{ type: 'paragraph', content: [{ type: 'text', text: '三つ目の項目' }] }] },
          ],
        },
      ]),
    );

    expect(markdown).toContain('2. 二つ目の項目');
    expect(markdown).toContain('3. 三つ目の項目');
  });

  it('writes links and emphasis', () => {
    const markdown = toMarkdown(
      documentWith([
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'リンクの前 ' },
            {
              type: 'link',
              href: 'https://example.com/',
              content: [{ type: 'text', text: 'リンク本体' }],
            },
            { type: 'text', text: ' 強調', emphasis: ['strong'] },
          ],
        },
      ]),
    );

    expect(markdown).toContain('[リンク本体](https://example.com/)');
    expect(markdown).toContain('** 強調**');
  });

  it('emits page markers so pages remain identifiable', () => {
    const document: AccessibleDocument = {
      metadata: { sourceUrl: null, pageCount: 2, producedBy: ['tagged-pdf'] },
      pages: [
        {
          pageNumber: 1,
          origin: 'tagged-pdf',
          status: 'available',
          nodes: [{ type: 'paragraph', content: [{ type: 'text', text: '一ページ目の本文' }] }],
        },
        {
          pageNumber: 2,
          origin: 'tagged-pdf',
          status: 'available',
          nodes: [{ type: 'paragraph', content: [{ type: 'text', text: '二ページ目の本文' }] }],
        },
      ],
    };

    const markdown = toMarkdown(document);
    expect(markdown).toContain('<!-- Page 1 -->');
    expect(markdown).toContain('<!-- Page 2 -->');
  });
});
