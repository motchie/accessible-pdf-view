import { describe, expect, it } from 'vitest';
import { sanitizeHref } from '../lib/pdf/sanitize-url';

/**
 * A PDF is untrusted input, and its links land in a page running with the
 * extension's own origin.
 */
describe('sanitizeHref', () => {
  it('allows the schemes a document link can legitimately use', () => {
    expect(sanitizeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(sanitizeHref('http://example.com/')).toBe('http://example.com/');
    expect(sanitizeHref('mailto:someone@example.com')).toBe('mailto:someone@example.com');
    expect(sanitizeHref('tel:+81-3-0000-0000')).toBe('tel:+81-3-0000-0000');
  });

  it('rejects script and privileged schemes', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBeNull();
    expect(sanitizeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(sanitizeHref('chrome-extension://abcdef/reader.html')).toBeNull();
    expect(sanitizeHref('file:///etc/passwd')).toBeNull();
  });

  it('rejects a scheme hidden behind control characters', () => {
    expect(sanitizeHref('java\nscript:alert(1)')).toBeNull();
    expect(sanitizeHref('java\tscript:alert(1)')).toBeNull();
    expect(sanitizeHref('  javascript:alert(1)')).toBeNull();
  });

  it('promotes a bare hostname to https rather than losing the link', () => {
    expect(sanitizeHref('example.com/docs')).toBe('https://example.com/docs');
  });

  it('strips a table pipe that pdf-inspector swept into the URL', () => {
    expect(sanitizeHref('https://example.com/facility/atelier/|')).toBe(
      'https://example.com/facility/atelier/',
    );
  });

  it('rejects links that only make sense inside the original document', () => {
    expect(sanitizeHref('#section-2')).toBeNull();
    expect(sanitizeHref('/relative/path')).toBeNull();
    expect(sanitizeHref('')).toBeNull();
    expect(sanitizeHref('   ')).toBeNull();
  });
});
