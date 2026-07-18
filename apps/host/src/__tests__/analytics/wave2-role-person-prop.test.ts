/**
 * REG-271 (part d) — role person-property on the LIVE identify path (P13).
 *
 * The live identify path is AuthContext.tsx's `identify()` imported from
 * packages/lib/src/posthog/client.ts (aliased as posthogIdentify). Wave 2b
 * (commit 45d1c3cf) made AuthContext stamp `role` on the person profile so the
 * acquisition/activation funnels can be segmented by role. The role reuses the
 * already-normalized activeRole (parent is internally 'guardian'), so the person
 * `role` facet shares ONE vocabulary with the funnel events signup_complete +
 * email_verified: student | teacher | guardian. institution_admin (B2B) is
 * mapped to `undefined` upstream in AuthContext, and this identify() wrapper's
 * allowlist filter drops `undefined` (and any non-allowlisted / PII key) before
 * anything reaches posthog.identify.
 *
 * Contract pinned here (against the REAL identify() wrapper — the production
 * function AuthContext calls, driven over a mocked posthog-js singleton):
 *   - a resolved funnel role (student|teacher|guardian) IS stamped.
 *   - role === undefined (the institution_admin outcome) is DROPPED.
 *   - non-allowlisted PII keys (email/full_name/phone/raw id) are DROPPED.
 *   - the distinctId that reaches posthog.identify is the HASH, never the raw uid (P13).
 *   - 'role' is in PERSON_PROPERTY_ALLOWLIST (the wall that makes the above hold).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the posthog-js singleton so identify()'s init() resolves to a fake with
// an `identify` spy. init() calls `posthog.init(key,{...,loaded})` then
// `posthog.identify(distinctId, props)`.
const phIdentify = vi.fn();
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    identify: (...a: unknown[]) => phIdentify(...a),
    capture: vi.fn(),
    reset: vi.fn(),
  },
}));

import { identify, reset } from '@alfanumrik/lib/posthog/client';
import { PERSON_PROPERTY_ALLOWLIST } from '@alfanumrik/lib/posthog/types';
import { hashUserIdForAnalytics } from '@alfanumrik/lib/posthog-client';

const AUTH_UID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

// identify() is fire-and-forget (async: hash → init → ph.identify). Wait for the
// spy rather than guessing a tick count.
async function waitForIdentify() {
  await vi.waitFor(() => expect(phIdentify).toHaveBeenCalled());
}

/** The props object that reached posthog.identify (2nd arg of the last call). */
function stampedProps(): Record<string, unknown> {
  const call = phIdentify.mock.calls.at(-1)!;
  return call[1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // PostHog is opt-in — readKey() requires the literal 'true' + a key.
  process.env.NEXT_PUBLIC_POSTHOG_ENABLED = 'true';
  process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
  reset(); // clear the in-module dedup guard so each test's identify() fires
});

describe('REG-271d — allowlist includes role (the segmentation enabler)', () => {
  it("'role' is in PERSON_PROPERTY_ALLOWLIST", () => {
    expect(PERSON_PROPERTY_ALLOWLIST.has('role')).toBe(true);
  });
});

describe('REG-271d — a resolved funnel role IS stamped on the person', () => {
  it.each(['student', 'teacher', 'guardian'])('role "%s" reaches posthog.identify', async (role) => {
    identify(`${AUTH_UID}-${role}`, { role, grade: '8', plan: 'free' });
    await waitForIdentify();
    expect(stampedProps().role).toBe(role);
  });
});

describe('REG-271d — institution_admin outcome (role: undefined) is DROPPED', () => {
  it('undefined role is filtered out; other allowlisted props still land', async () => {
    // AuthContext maps activeRole==='institution_admin' → role: undefined via
    // its ternary. The wrapper's filter drops undefined values.
    identify(`${AUTH_UID}-inst`, { role: undefined, grade: '9', plan: 'pro' });
    await waitForIdentify();
    const props = stampedProps();
    expect('role' in props).toBe(false);
    // The rest of the (allowlisted) person props still land.
    expect(props.grade).toBe('9');
    expect(props.plan).toBe('pro');
  });
});

describe('REG-271d — non-allowlisted PII keys never reach the person (P13)', () => {
  it('email/full_name/phone/name/raw-id are dropped; only allowlisted keys survive', async () => {
    identify(`${AUTH_UID}-pii`, {
      role: 'student',
      grade: '7',
      board: 'CBSE',
      // PII — must all be dropped by the allowlist filter.
      email: 'kid@example.com',
      full_name: 'Aarav Sharma',
      phone: '+919999999999',
      name: 'Aarav',
      auth_user_id: AUTH_UID,
    } as Record<string, unknown>);
    await waitForIdentify();
    const props = stampedProps();
    expect(Object.keys(props).sort()).toEqual(['board', 'grade', 'role']);
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain('kid@example.com');
    expect(serialized).not.toContain('Aarav');
    expect(serialized).not.toContain('+919999999999');
    expect(serialized).not.toContain(AUTH_UID);
  });
});

describe('REG-271d — distinctId is the HASH of the uid, never the raw uid (P13)', () => {
  it('posthog.identify receives the 16-hex hash, not the raw auth uid', async () => {
    identify(AUTH_UID, { role: 'guardian' });
    await waitForIdentify();
    const [distinctId] = phIdentify.mock.calls.at(-1)!;
    expect(distinctId).toBe(await hashUserIdForAnalytics(AUTH_UID));
    expect(distinctId).toMatch(/^[0-9a-f]{16}$/);
    expect(distinctId).not.toBe(AUTH_UID);
  });
});
