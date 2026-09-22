import type { InspectorRawResult } from '../../lib/pdf/inspector/protocol';

/** A pdf-inspector result with realistic defaults, overridable per test. */
export function inspectorResult(
  overrides: Partial<InspectorRawResult> = {},
): InspectorRawResult {
  return {
    pdfType: 'TextBased',
    markdown: '',
    pageCount: 1,
    processingTimeMs: 5,
    pagesNeedingOcr: [],
    ocrReasonsByPage: [],
    confidence: 1,
    layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
    hasEncodingIssues: false,
    ...overrides,
  };
}
