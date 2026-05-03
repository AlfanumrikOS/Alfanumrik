import { describe, it, expect } from 'vitest';
import { parseCsvLine } from '@/lib/rag/csv';

describe('parseCsvLine', () => {
  it('parses simple comma-separated cells', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted cell containing a comma', () => {
    expect(parseCsvLine('"hello, world",2,3')).toEqual(['hello, world', '2', '3']);
  });

  it('handles escaped quote inside a quoted cell', () => {
    expect(parseCsvLine('"He said ""hi""",2')).toEqual(['He said "hi"', '2']);
  });

  it('handles empty cells', () => {
    expect(parseCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('handles trailing empty cell', () => {
    expect(parseCsvLine('a,b,')).toEqual(['a', 'b', '']);
  });

  it('handles a fully-empty row', () => {
    expect(parseCsvLine('')).toEqual(['']);
  });

  it('handles a row with only quoted cells', () => {
    expect(parseCsvLine('"a","b","c"')).toEqual(['a', 'b', 'c']);
  });

  it('handles unicode + Devanagari script in cells', () => {
    expect(parseCsvLine('a,बोर्ड,c')).toEqual(['a', 'बोर्ड', 'c']);
  });

  it('preserves spaces (does not strip)', () => {
    expect(parseCsvLine('  a  ,  b  ')).toEqual(['  a  ', '  b  ']);
  });
});
