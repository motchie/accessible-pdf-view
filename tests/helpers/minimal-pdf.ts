/**
 * Builds a tiny, valid PDF in memory.
 *
 * Used so the pdf-inspector integration can be exercised without committing a
 * binary fixture to the repository. It is a real PDF — correct xref table and
 * all — not a stub, because the whole point of the test is that the Rust parser
 * accepts it.
 */
export interface MinimalPdfOptions {
  /** One entry per page; each string is drawn as a separate text line. */
  pages: string[][];
  title?: string;
  /**
   * Tag every line as a `P` in a structure tree. `declared` also writes
   * `/MarkInfo << /Marked true >>`; `undeclared` writes the tree alone, as some
   * producers do.
   */
  tagged?: 'declared' | 'undeclared';
  /**
   * With `tagged`, tag only each page's first this-many lines and draw the
   * rest as untagged content — a tree that covers part of the page.
   */
  taggedLines?: number;
  /** Raw content-stream operators drawn after each page's text. */
  drawing?: string;
  /** The page's `/Rotate`. */
  rotate?: number;
  /** The page's `/CropBox`; the media box stays [0 0 612 792]. */
  cropBox?: [number, number, number, number];
  /**
   * With `tagged`, `Figure` elements drawn after each page's text, each a
   * 100pt square unless `width` and `height` say otherwise. `alt` is written as `/Alt` when given, empty string
   * included; leave it out for a figure with no `/Alt` at all.
   */
  figures?: Array<{ alt?: string; width?: number; height?: number }>;
  /**
   * A line drawn after each page's text in a CID font from the Adobe-Japan1
   * collection that is neither embedded nor given a ToUnicode CMap, so the
   * only way to read it is the collection's own CID-to-Unicode mapping. Each
   * number is a CID, written through Identity-H.
   */
  japan1Cids?: number[];
}

/**
 * The CID font `japan1Cids` draws with, as its three objects: the Type0 font,
 * its descendant and the descriptor. Kozuka Mincho by name only: nothing is
 * embedded, which is the point.
 */
function japan1FontObjects(type0: number): string[] {
  const descendant = type0 + 1;
  const descriptor = type0 + 2;
  return [
    `<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPr6N-Regular /Encoding /Identity-H ` +
      `/DescendantFonts [${descendant} 0 R] >>`,
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPr6N-Regular ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> ` +
      `/FontDescriptor ${descriptor} 0 R /DW 1000 >>`,
    `<< /Type /FontDescriptor /FontName /KozMinPr6N-Regular /Flags 6 ` +
      `/FontBBox [0 -120 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 742 /StemV 80 >>`,
  ];
}

/** Stands in for the CID font's object number until it is known. */
const JAPAN1_FONT_REF = '@@JAPAN1@@';

export function buildMinimalPdf(options: MinimalPdfOptions): Uint8Array {
  const encoder = new TextEncoder();
  const objects: string[] = [];

  const pageCount = options.pages.length;
  // Object numbering: 1 catalog, 2 pages, 3 font, then per page a page object
  // and a content stream.
  const fontObj = 3;
  const firstPageObj = 4;

  const kids = options.pages
    .map((_, index) => `${firstPageObj + index * 2} 0 R`)
    .join(' ');

  // Structure objects follow the pages: the root, its parent tree, then one
  // `P` element per line.
  const structRootObj = firstPageObj + pageCount * 2;
  const parentTreeObj = structRootObj + 1;
  let nextElementObj = parentTreeObj + 1;
  const elements: number[] = [];
  const parentTreeNums: string[] = [];

  const catalogExtras =
    (options.tagged ? ` /StructTreeRoot ${structRootObj} 0 R` : '') +
    (options.tagged === 'declared' ? ' /MarkInfo << /Marked true >>' : '');
  objects[1] = `<< /Type /Catalog /Pages 2 0 R${catalogExtras} >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[fontObj] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  options.pages.forEach((lines, index) => {
    const pageObj = firstPageObj + index * 2;
    const contentObj = pageObj + 1;

    const pageElements: number[] = [];
    const content = lines
      .map((line, lineIndex) => {
        const size = lineIndex === 0 ? 24 : 12;
        const y = 720 - lineIndex * 30;
        const text = `BT /F1 ${size} Tf 72 ${y} Td (${escapePdfString(line)}) Tj ET`;
        if (!options.tagged) return text;
        if (options.taggedLines !== undefined && lineIndex >= options.taggedLines) return text;

        const elementObj = nextElementObj++;
        objects[elementObj] =
          `<< /Type /StructElem /S /P /P ${structRootObj} 0 R /Pg ${pageObj} 0 R /K ${lineIndex} >>`;
        pageElements.push(elementObj);
        return `/P << /MCID ${lineIndex} >> BDC ${text} EMC`;
      })
      .concat(
        options.tagged
          ? (options.figures ?? []).map((figure, figureIndex) => {
              const mcid = lines.length + figureIndex;
              const elementObj = nextElementObj++;
              const alt = figure.alt === undefined ? '' : ` /Alt (${escapePdfString(figure.alt)})`;
              objects[elementObj] =
                `<< /Type /StructElem /S /Figure /P ${structRootObj} 0 R /Pg ${pageObj} 0 R /K ${mcid}${alt} >>`;
              pageElements.push(elementObj);
              const x = 72 + figureIndex * 120;
              const width = figure.width ?? 100;
              const height = figure.height ?? 100;
              return `/Figure << /MCID ${mcid} >> BDC 0 0 1 rg ${x} 300 ${width} ${height} re f EMC`;
            })
          : [],
      )
      .join('\n')
      .concat(
        options.japan1Cids
          ? `\nBT /F2 12 Tf 72 ${720 - lines.length * 30} Td <${options.japan1Cids
              .map((cid) => cid.toString(16).padStart(4, '0'))
              .join('')}> Tj ET`
          : '',
      )
      .concat(options.drawing ? `\n${options.drawing}` : '');
    elements.push(...pageElements);
    parentTreeNums.push(`${index} [${pageElements.map((obj) => `${obj} 0 R`).join(' ')}]`);

    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      (options.rotate ? `/Rotate ${options.rotate} ` : '') +
      (options.cropBox ? `/CropBox [${options.cropBox.join(' ')}] ` : '') +
      `/Resources << /Font << /F1 ${fontObj} 0 R${options.japan1Cids ? ` /F2 ${JAPAN1_FONT_REF}` : ''} >> >> ` +
      `/Contents ${contentObj} 0 R` +
      (options.tagged ? ` /StructParents ${index}` : '') +
      ` >>`;
    objects[contentObj] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

  if (options.tagged) {
    objects[structRootObj] =
      `<< /Type /StructTreeRoot /K [${elements.map((obj) => `${obj} 0 R`).join(' ')}] ` +
      `/ParentTree ${parentTreeObj} 0 R >>`;
    objects[parentTreeObj] = `<< /Nums [${parentTreeNums.join(' ')}] >>`;
  }

  // The CID font goes last among the content objects: every number before it
  // depends on the page and element counts, and the pages refer to it.
  if (options.japan1Cids) {
    const type0 = objects.length;
    japan1FontObjects(type0).forEach((object, offset) => {
      objects[type0 + offset] = object;
    });
    for (let index = 0; index < objects.length; index++) {
      objects[index] = objects[index]?.replace(JAPAN1_FONT_REF, `${type0} 0 R`) as string;
    }
  }

  const infoObj = objects.length;
  if (options.title) {
    objects[infoObj] = `<< /Title (${escapePdfString(options.title)}) >>`;
  }

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  for (let index = 1; index < objects.length; index++) {
    const object = objects[index];
    if (object === undefined) continue;
    offsets[index] = body.length;
    body += `${index} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = body.length;
  const size = objects.length;

  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let index = 1; index < size; index++) {
    const offset = offsets[index] ?? 0;
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${size} /Root 1 0 R` +
    (options.title ? ` /Info ${infoObj} 0 R` : '') +
    ` >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return encoder.encode(body + xref + trailer);
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
