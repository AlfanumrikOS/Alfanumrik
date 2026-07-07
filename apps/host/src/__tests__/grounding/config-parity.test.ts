import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('grounding-config parity between Next.js and Deno', () => {
  const web = fs.readFileSync(path.resolve('src/lib/grounding-config.ts'), 'utf-8');
  const deno = fs.readFileSync(path.resolve('supabase/functions/grounded-answer/config.ts'), 'utf-8');

  const extract = (src: string, name: string) => {
    const m = src.match(new RegExp(`export const ${name}\\s*=\\s*([^;]+);`));
    return m ? m[1].trim() : null;
  };

  const constants = [
    'MIN_CHUNKS_FOR_READY', 'MIN_QUESTIONS_FOR_READY',
    'RAG_MATCH_COUNT', 'STRICT_MIN_SIMILARITY', 'SOFT_MIN_SIMILARITY',
    'SOFT_CONFIDENCE_BANNER_THRESHOLD', 'STRICT_CONFIDENCE_ABSTAIN_THRESHOLD',
  ];

  for (const name of constants) {
    it(`${name} matches between Next.js and Deno`, () => {
      expect(extract(web, name)).not.toBeNull();
      expect(extract(deno, name)).not.toBeNull();
      expect(extract(web, name)).toBe(extract(deno, name));
    });
  }
});