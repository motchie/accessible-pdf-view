import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The browser, swapped out.
 *
 * `wxt/browser` resolves the global once, when it is first imported, so a
 * global stubbed afterwards is never seen. The module is replaced instead, and
 * `browser` is read through a getter so each test can hand over a different
 * browser — or none, which is the state every other suite here runs in.
 */
const stub = vi.hoisted(() => ({ browser: undefined as unknown }));
vi.mock('wxt/browser', () => ({
  get browser() {
    return stub.browser;
  },
}));

import {
  PDF_URL_PATTERN,
  disablePdfHandler,
  enablePdfHandler,
  isPdfHandlerEnabled,
  isPdfHandlerSupported,
} from '../lib/browser/pdf-handler';
import { readParams } from '../lib/reader/params';

/**
 * The setting that sends PDFs to the Reader instead of the browser's viewer.
 *
 * Two halves of it can be checked without a browser, and they are the two that
 * decide whether a document opens correctly or not at all:
 *
 *   - which addresses the redirect rule claims, and
 *   - whether the Reader reads back exactly the address the rule handed it.
 *
 * What cannot be checked here is the browser's own behaviour — that it honours
 * the rule, and that the permission prompt appears. Those need Chrome.
 */

const pattern = new RegExp(PDF_URL_PATTERN, 'i');

describe('which addresses the redirect claims', () => {
  it('claims a PDF whether or not it carries a query', () => {
    expect(pattern.test('https://example.com/report.pdf')).toBe(true);
    expect(pattern.test('http://example.com/a/b/report.pdf')).toBe(true);
    expect(pattern.test('https://example.com/report.pdf?t=1')).toBe(true);
    expect(pattern.test('https://example.com/report.pdf?a=1&b=2')).toBe(true);
  });

  /** `.PDF` is common enough that missing it would look like the setting
   * simply not working. The rule is registered case-insensitively. */
  it('claims it whatever the case', () => {
    expect(pattern.test('https://example.com/REPORT.PDF')).toBe(true);
    expect(pattern.test('https://example.com/Report.Pdf')).toBe(true);
  });

  /**
   * The false positive worth avoiding: a page that *displays* a PDF is not a
   * PDF, and redirecting it would send the Reader off to fetch HTML and report
   * that the document is not a PDF. `.pdf` has to end the path.
   */
  it('leaves a viewer page that merely names a PDF alone', () => {
    expect(pattern.test('https://example.com/viewer?file=report.pdf')).toBe(false);
    expect(pattern.test('https://example.com/read#report.pdf')).toBe(false);
  });

  it('leaves alone what it cannot open anyway', () => {
    // A local file needs a permission no extension can ask for.
    expect(pattern.test('file:///home/reader/report.pdf')).toBe(false);
    // The Reader itself, which must never redirect into itself.
    expect(pattern.test('chrome-extension://abcdef/reader.html#src=x')).toBe(false);
    expect(pattern.test('https://example.com/report.pdfx')).toBe(false);
    expect(pattern.test('https://example.com/report.html')).toBe(false);
  });
});

/**
 * The address travels in the fragment because the rule substitutes it in
 * literally, with nothing able to encode it. These are the cases that would
 * silently open the wrong document if it travelled in a query parameter.
 */
describe('reading back the address the rule handed over', () => {
  it('takes everything after the marker as the address', () => {
    expect(readParams('', '#src=https://example.com/report.pdf').sourceUrl).toBe(
      'https://example.com/report.pdf',
    );
  });

  it("keeps a PDF's own query intact, ampersands and all", () => {
    const address = 'https://example.com/report.pdf?doc=1&page=2&token=a%2Bb';
    expect(readParams('', `#src=${address}`).sourceUrl).toBe(address);
  });

  it('prefers the query, which is the flow that can also carry bytes', () => {
    const params = readParams(
      '?src=https://example.com/first.pdf&handoff=abc',
      '#src=https://example.com/second.pdf',
    );
    expect(params.sourceUrl).toBe('https://example.com/first.pdf');
    expect(params.handoffId).toBe('abc');
  });

  it('claims no address when the fragment is something else', () => {
    expect(readParams('', '#page=2').sourceUrl).toBeNull();
    expect(readParams('', '').sourceUrl).toBeNull();
    expect(readParams('', '#src=').sourceUrl).toBeNull();
  });
});

/**
 * Outside an extension there is no `browser` at all — which is the state every
 * other suite here runs in, and the state the stub above leaves behind — and
 * the settings panel imports this module at the top level regardless.
 * Reporting "unsupported" rather than throwing is what keeps that harmless.
 */
describe('where the APIs do not exist', () => {
  it('reports itself unsupported instead of crashing', () => {
    expect(isPdfHandlerSupported()).toBe(false);
  });

  it('answers "off" rather than failing', async () => {
    await expect(isPdfHandlerEnabled()).resolves.toBe(false);
  });

  it('turns off quietly, because there is nothing to turn off', async () => {
    await expect(disablePdfHandler()).resolves.toBeUndefined();
  });
});

/**
 * The rule itself, against a stand-in for the browser.
 *
 * Every claim here is something no type can catch and nothing else in this
 * repository exercises: a redirect that names the wrong page, or forgets that
 * the address goes in the fragment, or claims subframes as well, is a setting
 * that appears to work and quietly breaks documents. The browser honouring the
 * rule is the part that still needs Chrome.
 */
describe('the rule the browser is given', () => {
  const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

  interface RuleUpdate {
    removeRuleIds?: number[];
    addRules?: {
      id: number;
      action: { type: string; redirect?: { regexSubstitution?: string } };
      condition: {
        regexFilter?: string;
        resourceTypes?: string[];
        excludedInitiatorDomains?: string[];
        isUrlFilterCaseSensitive?: boolean;
      };
    }[];
  }

  /** What the browser was asked to do, in order. The order matters once:
   * turning the setting off has to stop the redirect before it gives the
   * access back, not after. */
  let log: string[] = [];
  let updates: RuleUpdate[] = [];

  function browserThatGrants(granted: boolean): void {
    log = [];
    updates = [];
    stub.browser = {
      runtime: {
        id: EXTENSION_ID,
        getURL: (path: string) => `chrome-extension://${EXTENSION_ID}${path}`,
      },
      permissions: {
        request: async () => {
          log.push('request');
          return granted;
        },
        remove: async () => {
          log.push('remove');
          return true;
        },
        contains: async () => granted,
      },
      declarativeNetRequest: {
        updateDynamicRules: async (update: RuleUpdate) => {
          log.push(update.addRules ? 'add' : 'drop');
          updates.push(update);
        },
        getDynamicRules: async () => [],
      },
    };
  }

  afterEach(() => {
    stub.browser = undefined;
  });

  it('sends a matching address to the Reader, in the fragment', async () => {
    browserThatGrants(true);
    expect(await enablePdfHandler()).toBe(true);

    const rule = updates.at(-1)?.addRules?.[0];
    expect(rule?.action.type).toBe('redirect');
    expect(rule?.action.redirect?.regexSubstitution).toBe(
      `chrome-extension://${EXTENSION_ID}/reader.html#src=\\0`,
    );
  });

  it('claims top-level navigations only', async () => {
    browserThatGrants(true);
    await enablePdfHandler();

    const condition = updates.at(-1)?.addRules?.[0]?.condition;
    // An embedded PDF belongs to the page around it.
    expect(condition?.resourceTypes).toEqual(['main_frame']);
    expect(condition?.isUrlFilterCaseSensitive).toBe(false);
    // Nothing about who started the navigation. `excludedInitiatorDomains`
    // with this extension's own id was measured in Chrome not to exclude a
    // top-level navigation from an extension page, so carrying it would be a
    // condition that reads like a guarantee and is not one.
    expect(condition?.excludedInitiatorDomains).toBeUndefined();
  });

  it('registers no rule when the permission is refused', async () => {
    browserThatGrants(false);
    expect(await enablePdfHandler()).toBe(false);
    expect(log).toEqual(['request']);
  });

  it('stops redirecting before it hands the access back', async () => {
    browserThatGrants(true);
    await disablePdfHandler();
    expect(log).toEqual(['drop', 'remove']);
  });

  it('reports itself on only when the rule and the access are both there', async () => {
    browserThatGrants(true);
    // The fake answers `getDynamicRules` with nothing, which is the state the
    // browser is left in when host access is withdrawn from its own extensions
    // page: the permission check alone would call this on.
    await expect(isPdfHandlerEnabled()).resolves.toBe(false);
  });
});
