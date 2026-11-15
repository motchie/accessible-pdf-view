import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { PdfCapabilities } from '../lib/pdf/document-model';
import { OcrRequiredNotice } from '../lib/reader/components/Notices';
import { inLocale } from './helpers/messages';

/**
 * Which pages need OCR, then that OCR may help: two sentences, joined as each
 * language joins them. A literal space between them gave 「…ません。 OCR…」.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Every field, so a new one the notice reads has to be given a value here.
const CAPABILITIES: PdfCapabilities = {
  hasExtractableText: true,
  requiresOcr: true,
  ocrPages: [3],
  isScanned: false,
  isImageBased: false,
  isMixed: true,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(locale: 'en' | 'ja'): string {
  act(() => {
    root.render(
      inLocale(
        locale,
        <OcrRequiredNotice
          capabilities={CAPABILITIES}
          viewingOriginal={false}
        />,
      ),
    );
  });
  return container.textContent ?? '';
}

it('joins the two sentences without a space in Japanese', () => {
  expect(render('ja')).toContain('含まれていません。OCR（文字認識）を行うと');
});

it('joins them with a space in English', () => {
  expect(render('en')).toContain('contains no readable text. Running OCR');
});
