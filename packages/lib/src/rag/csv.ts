/**
 * Minimal CSV utilities for Phase 4.6 Track B (public-domain PYQ ingestion).
 *
 * Pure - no IO, no React, no side effects. Used by scripts/csv-to-rag-pack.ts
 * to convert a curator's CSV of board PYQ extracts into JSONL packs.
 */

/**
 * Parse a single CSV line into cells. Supports double-quoted cells with
 * embedded commas and "" escaped quotes. Does NOT support multi-line
 * quoted cells - callers should ensure each row is on a single line
 * (replace embedded newlines with spaces during curation).
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"' && cur === '') {
        inQ = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}
