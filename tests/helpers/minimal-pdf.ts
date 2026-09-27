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
}

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
      .join('\n')
      .concat(options.drawing ? `\n${options.drawing}` : '');
    elements.push(...pageElements);
    parentTreeNums.push(`${index} [${pageElements.map((obj) => `${obj} 0 R`).join(' ')}]`);

    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      (options.rotate ? `/Rotate ${options.rotate} ` : '') +
      (options.cropBox ? `/CropBox [${options.cropBox.join(' ')}] ` : '') +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentObj} 0 R` +
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
