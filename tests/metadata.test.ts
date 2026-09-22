import { describe, expect, it } from 'vitest';
import { isMarked, parsePdfDate } from '../lib/pdf/pdfjs/metadata';
import { parseListLabel } from '../lib/pdf/pdfjs/tagged-adapter';

describe('parsePdfDate', () => {
  it('parses a full date with a timezone offset', () => {
    // As a real document wrote it.
    expect(parsePdfDate("D:20260722084802+09'00'")).toBe('2026-07-21T23:48:02.000Z');
  });

  it('parses the truncated forms that real producers emit', () => {
    expect(parsePdfDate('D:2026')).toBe('2026-01-01T00:00:00.000Z');
    expect(parsePdfDate('D:20260722')).toBe('2026-07-22T00:00:00.000Z');
    expect(parsePdfDate('D:20260722084802Z')).toBe('2026-07-22T08:48:02.000Z');
    // Some writers omit the apostrophes.
    expect(parsePdfDate('D:20260722084802-0500')).toBe('2026-07-22T13:48:02.000Z');
  });

  it('returns nothing for values it cannot trust', () => {
    expect(parsePdfDate(undefined)).toBeUndefined();
    expect(parsePdfDate('')).toBeUndefined();
    expect(parsePdfDate('22 July 2026')).toBeUndefined();
    expect(parsePdfDate('D:20261399999999')).toBeUndefined();
  });
});

describe('parseListLabel', () => {
  it('recognises full-width numbers, which Japanese documents use', () => {
    expect(parseListLabel('１')).toEqual({ ordered: true, number: 1 });
    expect(parseListLabel('２.')).toEqual({ ordered: true, number: 2 });
    expect(parseListLabel('（3）')).toEqual({ ordered: true, number: 3 });
  });

  it('recognises letters and roman numerals without claiming a position', () => {
    expect(parseListLabel('iv.')).toEqual({ ordered: true });
    expect(parseListLabel('a)')).toEqual({ ordered: true });
  });

  it('treats bullets as unordered', () => {
    expect(parseListLabel('•')).toEqual({ ordered: false });
    expect(parseListLabel('・')).toEqual({ ordered: false });
    expect(parseListLabel('-')).toEqual({ ordered: false });
    expect(parseListLabel('')).toEqual({ ordered: false });
  });
});

/**
 * `/MarkInfo` arrives in whatever shape the installed PDF.js feels like.
 *
 * PDF.js 6.3 changed it from a plain object to a `Map` while its own type
 * declaration went on saying object — so the old reader type-checked, read
 * `undefined`, and quietly turned the tagged reading off for every tagged
 * document. The compiler could not have caught it. These can.
 */
describe('reading the tagged flag', () => {
  it('reads a Map, which is what PDF.js 6.3 returns', () => {
    expect(isMarked(new Map([['Marked', true]]))).toBe(true);
    expect(isMarked(new Map([['Marked', false]]))).toBe(false);
    expect(isMarked(new Map())).toBe(false);
  });

  it('reads a plain object, which is what earlier versions returned', () => {
    expect(isMarked({ Marked: true })).toBe(true);
    expect(isMarked({ Marked: false })).toBe(false);
    expect(isMarked({})).toBe(false);
  });

  it('treats anything else as untagged rather than throwing', () => {
    // A document with no `/MarkInfo` at all is the common case.
    expect(isMarked(null)).toBe(false);
    expect(isMarked(undefined)).toBe(false);
    expect(isMarked('Marked')).toBe(false);
  });
});
