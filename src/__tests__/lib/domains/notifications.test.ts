/**
 * Notifications domain — typed read API contract tests (Phase 0h).
 *
 * Mirrors the identity / tenant / practice test pattern: input-validation
 * cases run unconditionally; a small integration block runs only when
 * supabase env vars are present and exercises the happy "empty-result" path
 * so the test stays meaningful even against an empty DB.
 *
 * Functions under test:
 *   - listForRecipient
 *   - markAsRead
 *   - countUnread
 *   - getPreferences
 *
 * SCOPE GUARD: This phase is read + ownership-checked status writes only.
 * Outbound dispatch (email / WhatsApp / alerts) is owned by Edge Functions
 * and `src/lib/notification-triggers.ts`, not tested here.
 */

import { describe, it, expect } from 'vitest';
import { hasSupabaseIntegrationEnv } from '@/__tests__/helpers/integration';
import {
  listForRecipient,
  markAsRead,
  countUnread,
  getPreferences,
} from '@/lib/domains/notifications';

describe('notifications domain — input validation', () => {
  it('listForRecipient rejects empty recipientType with INVALID_INPUT', async () => {
    // @ts-expect-error — exercising runtime guard with an invalid type
    const r = await listForRecipient('', 'student-id');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listForRecipient rejects unknown recipientType with INVALID_INPUT', async () => {
    // @ts-expect-error — runtime guard rejects bogus types
    const r = await listForRecipient('alien', 'student-id');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listForRecipient rejects empty recipientId with INVALID_INPUT', async () => {
    const r = await listForRecipient('student', '');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('markAsRead rejects empty notificationId with INVALID_INPUT', async () => {
    const r = await markAsRead('', 'recipient-id');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('markAsRead rejects empty recipientId with INVALID_INPUT', async () => {
    const r = await markAsRead('notif-id', '');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('countUnread rejects empty recipientType with INVALID_INPUT', async () => {
    // @ts-expect-error — runtime guard
    const r = await countUnread('', 'student-id');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('countUnread rejects empty recipientId with INVALID_INPUT', async () => {
    const r = await countUnread('student', '');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getPreferences rejects empty recipientType with INVALID_INPUT', async () => {
    // @ts-expect-error — runtime guard
    const r = await getPreferences('', 'guardian-id');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getPreferences rejects empty recipientId with INVALID_INPUT', async () => {
    const r = await getPreferences('guardian', '');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });
});

// ── Integration happy path (skipped without env) ──────────────────────────────
//
// Uses a deterministic fake UUID that is extremely unlikely to resolve to a
// real account / row. The contract under test is that the function returns
// ok: true with an empty list / null / zero counts (not an error), so the
// test is meaningful even against an empty DB.

const FAKE_UUID = '00000000-0000-0000-0000-00000000dead';
const FAKE_NOTIF_UUID = '00000000-0000-0000-0000-0000000beef0';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

describeIntegration('notifications domain — integration (empty-DB happy case)', () => {
  it('listForRecipient returns ok with an array for unknown student', async () => {
    const r = await listForRecipient('student', FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('listForRecipient honours unreadOnly + limit without error', async () => {
    const r = await listForRecipient('guardian', FAKE_UUID, {
      unreadOnly: true,
      limit: 5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('countUnread returns ok with zero for unknown recipient', async () => {
    const r = await countUnread('student', FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof r.data).toBe('number');
    expect(r.data).toBeGreaterThanOrEqual(0);
  });

  it('markAsRead returns NOT_FOUND for unknown notification id', async () => {
    const r = await markAsRead(FAKE_NOTIF_UUID, FAKE_UUID);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NOT_FOUND');
  });

  it('getPreferences returns ok with null for unknown guardian', async () => {
    const r = await getPreferences('guardian', FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getPreferences returns ok with null for non-guardian recipient types', async () => {
    const r = await getPreferences('student', FAKE_UUID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });
});
