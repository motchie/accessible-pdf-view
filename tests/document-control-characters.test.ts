import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { AccessibleDocument, DocumentNode, FigureNode } from '../lib/pdf/document-model';
import { documentToPlainText } from '../lib/pdf/document-model';
import { documentWithoutControlCharacters } from '../lib/pdf/control-characters';
import { markdownToPages } from '../lib/pdf/inspector/markdown-to-document';
import { readPdfDocumentInfo } from '../lib/pdf/pdfjs/metadata';
import { extractTaggedDocument } from '../lib/pdf/pdfjs/tagged-adapter';
import { decorate } from '../lib/reader/readings';
import { buildMinimalPdf } from './helpers/minimal-pdf';
import { readPdfAsReader } from './helpers/read-pdf';

/**
 * Control characters out of everything the Reader shows (#52), not only the
 * tagged `/Alt` and the Markdown view (#51). A NUL that reaches the page ends
 * a selection copied from it at that point, through the Windows clipboard.
 */

const ANY_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Every string anywhere in a value. Not JSON.stringify, which escapes
 * control characters into plain ASCII and would hide them from a regex. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

function hasControl(value: unknown): boolean {
  return strings(value).some((s) => ANY_CONTROL.test(s));
}

function text(value: string) {
  return { type: 'text' as const, text: value };
}

function documentOf(nodes: DocumentNode[], title?: string): AccessibleDocument {
  return {
    metadata: { sourceUrl: null, pageCount: 1, producedBy: ['pdf-inspector'], ...(title ? { title } : {}) },
    pages: [{ pageNumber: 1, origin: 'pdf-inspector', status: 'available', nodes }],
  };
}

describe('documentWithoutControlCharacters', () => {
  const figure: FigureNode = {
    type: 'figure',
    alternativeText: 'A chart\u0000',
    alternativeTextSource: 'generated',
    caption: 'Figure\u000B1',
    status: 'available',
  };
  const dirty = documentOf(
    [
      { type: 'heading', level: 2, content: [text('Head\u0000ing')] },
      {
        type: 'paragraph',
        content: [text('Body\u0000'), { type: 'link', href: 'https://example.com/', content: [text('li\u0000nk')] }, { type: 'line-break' }],
      },
      { type: 'list', ordered: false, items: [{ blocks: [{ type: 'paragraph', content: [text('item\u0000')] }] }] },
      {
        type: 'table',
        caption: 'Cap\u0000',
        header: { cells: [{ header: true, content: [text('H\u0000')] }] },
        rows: [{ cells: [{ header: false, content: [text('c\u0000')], blocks: [{ type: 'paragraph', content: [text('b\u0000')] }] }] }],
      },
      figure,
      { type: 'blockquote', blocks: [{ type: 'paragraph', content: [text('quote\u0000')] }] },
      { type: 'code', text: 'x\u0000' },
      { type: 'unknown', content: [text('odd\u0000')] },
      { type: 'thematic-break' },
    ],
    'Title\u0000',
  );

  it('cleans every piece of text the document shows', () => {
    const clean = documentWithoutControlCharacters(dirty);

    expect(hasControl(dirty)).toBe(true);
    expect(hasControl(clean)).toBe(false);
    expect(clean.metadata.title).toBe('Title');
    expect(documentToPlainText(clean)).toContain('Heading');
    expect(clean.pages[0]!.nodes[4]).toEqual({ ...figure, alternativeText: 'A chart', caption: 'Figure 1' });
  });

  it('changes only strings: hrefs, statuses and sources stay as they were', () => {
    const clean = documentWithoutControlCharacters(dirty);
    const paragraph = clean.pages[0]!.nodes[1] as Extract<DocumentNode, { type: 'paragraph' }>;

    expect(paragraph.content[1]).toEqual({ type: 'link', href: 'https://example.com/', content: [text('link')] });
    // A describer's empty description is a decorative verdict, so an emptied
    // one keeps its source and status rather than being guessed at here.
    const emptied = documentWithoutControlCharacters(documentOf([{ ...figure, alternativeText: '\u0000' }]));
    expect(emptied.pages[0]!.nodes[0]).toMatchObject({ alternativeText: '', alternativeTextSource: 'generated', status: 'available' });
  });

  it('returns what has nothing to clean as it was, so a second pass copies nothing', () => {
    const clean = documentWithoutControlCharacters(dirty);

    expect(documentWithoutControlCharacters(clean)).toBe(clean);
    // Untouched parts of a document that is cleaned keep their identity.
    const partly = documentOf([{ type: 'thematic-break' }, { type: 'paragraph', content: [text('a\u0000')] }]);
    expect(documentWithoutControlCharacters(partly).pages[0]!.nodes[0]).toBe(partly.pages[0]!.nodes[0]);
  });

  it('is applied by decorate, which every reading passes through', () => {
    const decorated = decorate(dirty, { info: { isTagged: false, hasStructureTree: false }, language: undefined, kinds: new Map() });
    expect(hasControl(decorated)).toBe(false);
  });
});

describe('where control characters enter', () => {
  it('a NUL in a tagged PDF\'s page text does not reach the Reader', async () => {
    // Synthetic: no real document with NUL in its page text has been seen.
    // PDF.js passes the character code through, so the tag tree's text has it.
    const bytes = buildMinimalPdf({ pages: [['Heading', 'Body\u0000text here.']], tagged: 'declared' });
    // The reader first: it also points PDF.js at its worker.
    const reading = await readPdfAsReader(bytes, { preferred: 'tagged-pdf' });
    const pdf = await pdfjs.getDocument({
      data: bytes.slice(0),
      standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/`,
    }).promise;
    const extracted = await extractTaggedDocument(pdf, { info: await readPdfDocumentInfo(pdf) });
    expect(documentToPlainText(extracted!.document)).toContain('Body\u0000text');

    expect(reading.structureSource).toBe('tagged-pdf');
    // Neither the reading as built nor the document shown keeps it.
    expect(documentToPlainText(reading.raw['tagged-pdf']!)).toContain('Bodytext here.');
    expect(documentToPlainText(reading.document)).toContain('Bodytext here.');
  });

  it('a NUL in the title and its heading changes neither the readings nor their heading counts', async () => {
    // The Info title is cleaned when it is read, so the readings must be too
    // before anything asks whether a first heading only repeats the title:
    // `combineReadings` and the picker's heading counts both do.
    const pdfWith = (mark: string) =>
      buildMinimalPdf({
        pages: [[`Report${mark}`, 'Body text.']],
        title: `Report${mark}`,
        tagged: 'declared',
        headingLines: 1,
      });
    const [clean, dirty] = await Promise.all([
      readPdfAsReader(pdfWith('')),
      readPdfAsReader(pdfWith('\u0000')),
    ]);

    expect(dirty.availableSources).toEqual(clean.availableSources);
    expect(dirty.headingCounts).toEqual(clean.headingCounts);
    expect(dirty.info.title).toBe('Report');
  });

  it('pdf-inspector: an alt of nothing but control characters is no description', () => {
    // Not NUL: the Markdown parser already turns that into U+FFFD, as CommonMark
    // requires, so pdf-inspector's reading never carries one. The other C0
    // controls it keeps.
    const [nul] = markdownToPages('![logo\u0000](a.png)\n');
    expect(nul!.nodes[0]).toMatchObject({ alternativeText: 'logo\uFFFD' });

    const [page] = markdownToPages('![logo\u0001](a.png)\n\n![\u0001\u0002](b.png)\n');
    expect(page!.nodes[0]).toMatchObject({ alternativeText: 'logo', status: 'available' });
    expect(page!.nodes[1]).toMatchObject({ status: 'missing-alt' });
    expect(page!.nodes[1]).not.toHaveProperty('alternativeText');
  });

  it('the Info dictionary, which gives the title and fills the information panel', async () => {
    const pdf = {
      numPages: 0,
      getMetadata: async () => ({ info: { Title: 'Annual report\u0000', Author: 'A.\u000BAuthor' }, metadata: null }),
      getMarkInfo: async () => null,
    } as unknown as PDFDocumentProxy;

    const info = await readPdfDocumentInfo(pdf);
    expect(info.title).toBe('Annual report');
    expect(info.author).toBe('A. Author');
  });
});
