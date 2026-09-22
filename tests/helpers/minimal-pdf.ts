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

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[fontObj] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  options.pages.forEach((lines, index) => {
    const pageObj = firstPageObj + index * 2;
    const contentObj = pageObj + 1;

    const content = lines
      .map((line, lineIndex) => {
        const size = lineIndex === 0 ? 24 : 12;
        const y = 720 - lineIndex * 30;
        return `BT /F1 ${size} Tf 72 ${y} Td (${escapePdfString(line)}) Tj ET`;
      })
      .join('\n');

    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });

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
