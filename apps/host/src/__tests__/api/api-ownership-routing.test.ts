import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('API ownership routing guardrails', () => {
  function source(file: string): string {
    return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
  }

  it('documents canonical owners and removal telemetry requirements', () => {
    const doc = source('docs/architecture/api-ownership-map.md');

    expect(doc).toContain('POST /api/v2/quiz/start');
    expect(doc).toContain('GET /api/v2/quiz/questions');
    expect(doc).toContain('POST /api/v2/quiz/submit');
    expect(doc).toContain('POST /api/scan-solve');
    expect(doc).toContain('POST /api/foxy');
    expect(doc).toContain('POST /api/cron/daily-cron');
    expect(doc).toContain('zero usage for at least 30 days');
  });

  it('keeps Foxy frontend chat on the canonical tutor path', () => {
    const hook = source('src/app/foxy/_hooks/useFoxyChat.ts');
    const legacy = /functions\/v1\/(grounded-answer|alfabot-answer)/;

    expect(hook).toContain("fetch('/api/foxy'");
    expect(hook).not.toMatch(legacy);
  });

  it('keeps scan solver frontend on the canonical Next.js path', () => {
    const component = source('src/components/ScanSolver.tsx');

    expect(component).toContain("fetch('/api/scan-solve'");
    expect(component).not.toContain('/functions/v1/ncert-solver');
    expect(component).not.toContain('/functions/v1/ncert-question-engine');
  });

  it('keeps parent encouragement frontend on the canonical v2 path', () => {
    const component = source('src/components/parent/EncourageButton.tsx');

    expect(component).toContain("fetch('/api/v2/parent/encourage'");
    expect(component).not.toContain('/functions/v1/parent-portal');
  });

  it('the deprecated /api/cron/daily alias stays deleted (P1 batch 2026-08-03, architect-approved)', () => {
    // The alias was scheduled by nothing and carried only deprecation telemetry;
    // it was removed alongside the verifyCronAuth consolidation. This pin
    // prevents the dead alias from being silently reintroduced.
    const deleted = path.resolve(process.cwd(), 'src/app/api/cron/daily/route.ts');
    expect(fs.existsSync(deleted)).toBe(false);
  });
});
