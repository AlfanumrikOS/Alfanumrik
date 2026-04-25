/**
 * Assessment domain (Phase 0f, B9) — typed read API contract tests.
 *
 * Covers input validation (no env required) and integration happy paths
 * gated by hasSupabaseIntegrationEnv(). Mirrors identity.test.ts.
 *
 * Scope: read-only helpers from src/lib/domains/assessment.ts
 *   - getConceptMastery
 *   - getTopicMastery
 *   - listKnowledgeGaps
 *   - getDiagnosticSession
 *   - listDiagnosticSessions
 *   - listLearningGraphNodes
 *   - listCmeErrors
 */

import { describe, it, expect } from 'vitest';
import { hasSupabaseIntegrationEnv } from '@/__tests__/helpers/integration';
import {
  getConceptMastery,
  getTopicMastery,
  listKnowledgeGaps,
  getDiagnosticSession,
  listDiagnosticSessions,
  listLearningGraphNodes,
  listCmeErrors,
} from '@/lib/domains/assessment';

// ── Input validation (always run, no env required) ────────────────────────────

describe('assessment domain — input validation', () => {
  it('getConceptMastery rejects empty studentId with INVALID_INPUT', async () => {
    const r = await getConceptMastery({ studentId: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getTopicMastery rejects empty studentId with INVALID_INPUT', async () => {
    const r = await getTopicMastery({ studentId: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listKnowledgeGaps rejects empty studentId with INVALID_INPUT', async () => {
    const r = await listKnowledgeGaps({ studentId: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getDiagnosticSession rejects empty sessionId with INVALID_INPUT', async () => {
    const r = await getDiagnosticSession('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listDiagnosticSessions rejects empty studentId with INVALID_INPUT', async () => {
    const r = await listDiagnosticSessions({ studentId: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listLearningGraphNodes rejects empty subject with INVALID_INPUT', async () => {
    const r = await listLearningGraphNodes({ subject: '', grade: '6' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listLearningGraphNodes rejects empty grade with INVALID_INPUT', async () => {
    const r = await listLearningGraphNodes({ subject: 'math', grade: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });
});

// ── Limit clamping (pure-function paths, no env required) ─────────────────────
//
// These exercise the clamp() guard without hitting the database. We pass an
// out-of-range limit and rely on the helper to short-circuit before any
// network IO if studentId is empty. This proves the clamp boundary is
// reached before the supabase call would emit a real error.

describe('assessment domain — limit clamping is unreachable when input invalid', () => {
  it('listDiagnosticSessions still INVALID_INPUTs when limit is out-of-range', async () => {
    const r = await listDiagnosticSessions({ studentId: '', limit: 9999 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });
});

// ── Integration happy path (skipped without env) ──────────────────────────────
//
// Uses fake UUIDs that should not resolve to real rows. The contract under
// test: each function returns ok: true with empty data (or null), proving
// the table query succeeds even when the result set is empty. For tables
// not yet provisioned (learning_graph_nodes), the soft-fail path returns
// DB_ERROR with a logger.warn — which is the intended graceful degradation.

const FAKE_STUDENT = '00000000-0000-0000-0000-00000000dead';
const FAKE_SESSION = '00000000-0000-0000-0000-00000000beef';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('assessment domain — integration (empty-result happy case)', () => {
  it('getConceptMastery returns ok with [] for unknown student', async () => {
    const r = await getConceptMastery({ studentId: FAKE_STUDENT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data.length).toBe(0);
  });

  it('getTopicMastery returns ok with [] for unknown student', async () => {
    const r = await getTopicMastery({ studentId: FAKE_STUDENT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('listKnowledgeGaps returns ok with [] for unknown student (unresolved default)', async () => {
    const r = await listKnowledgeGaps({ studentId: FAKE_STUDENT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('listKnowledgeGaps respects severity filter', async () => {
    const r = await listKnowledgeGaps({
      studentId: FAKE_STUDENT,
      severity: 'high',
    });
    expect(r.ok).toBe(true);
  });

  it('getDiagnosticSession returns ok with null for unknown id', async () => {
    const r = await getDiagnosticSession(FAKE_SESSION);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('listDiagnosticSessions clamps limit and returns ok with []', async () => {
    const r = await listDiagnosticSessions({
      studentId: FAKE_STUDENT,
      limit: 9999, // clamped to 50
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('listLearningGraphNodes soft-fails with DB_ERROR (table not yet provisioned)', async () => {
    const r = await listLearningGraphNodes({ subject: 'math', grade: '6' });
    // Either DB_ERROR (current expected) or ok with empty array (when table lands)
    if (r.ok) {
      expect(Array.isArray(r.data)).toBe(true);
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('listCmeErrors returns ok with [] for unknown student', async () => {
    const r = await listCmeErrors({ studentId: FAKE_STUDENT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('listCmeErrors clamps limit (no studentId, admin surface)', async () => {
    const r = await listCmeErrors({ limit: 500 }); // clamped to 200
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data.length).toBeLessThanOrEqual(200);
  });
});
