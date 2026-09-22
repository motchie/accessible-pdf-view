import { describe, expect, it } from 'vitest';
import { hostOf, isSiteAccessSupported, originPatternFor } from '../lib/browser/site-access';

/**
 * Asking the browser for one site.
 *
 * The pattern is the whole of what somebody is agreeing to, so it is the part
 * worth pinning without a browser: too wide and the prompt asks for more than
 * the document needs, too narrow and the next PDF in the same folder asks
 * again.
 */
describe('what is asked for', () => {
  it('asks for the site, not the file', () => {
    expect(originPatternFor('https://example.com/news/pdf/report.pdf')).toBe(
      'https://example.com/*',
    );
  });

  it('keeps the scheme, which is part of what is granted', () => {
    expect(originPatternFor('http://example.com/a.pdf')).toBe('http://example.com/*');
  });

  /**
   * A match pattern's host cannot carry a port — both browsers reject one, so
   * `http://localhost:8000/*` would have thrown instead of prompting. A PDF on
   * a local web server is how this gets found, and that is not an exotic case:
   * it is how this project's own sample documents are opened, because the
   * Reader cannot read `file:`.
   */
  it('drops the port, which a match pattern may not carry', () => {
    expect(originPatternFor('http://localhost:8000/sample-en.pdf')).toBe(
      'http://localhost/*',
    );
    expect(originPatternFor('https://example.com:8443/a.pdf')).toBe('https://example.com/*');
  });

  /**
   * Nothing to ask about, or nothing an extension is allowed to ask for. A
   * local file needs a switch on the browser's own extensions page that no
   * extension can request, so offering a prompt for it would be a button that
   * cannot work.
   */
  it('has nothing to ask for where a permission would not help', () => {
    expect(originPatternFor('file:///home/reader/report.pdf')).toBeNull();
    expect(originPatternFor('blob:https://example.com/abc')).toBeNull();
    expect(originPatternFor('data:application/pdf;base64,AAAA')).toBeNull();
    expect(originPatternFor('not a url')).toBeNull();
  });

  /** The grant covers every port on the host, so the sentence that asks for it
   * names the host — saying `example.com:8443` would describe something
   * narrower than what is actually being agreed to. */
  it('names the site the way the grant actually works', () => {
    expect(hostOf('https://example.com:8443/a.pdf')).toBe('example.com');
    expect(hostOf('http://localhost:8000/a.pdf')).toBe('localhost');
    expect(hostOf('file:///a.pdf')).toBeNull();
  });

  /** Outside an extension there is no `browser`, which is the state every
   * suite here runs in — and the Reader imports this module regardless. */
  it('offers nothing where there is no browser to ask', () => {
    expect(isSiteAccessSupported()).toBe(false);
  });
});
