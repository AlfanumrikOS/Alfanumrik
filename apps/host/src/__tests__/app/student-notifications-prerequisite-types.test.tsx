/**
 * /notifications page — Loop D prerequisite_blocked / prerequisite_resolved
 * TYPE_CONFIG entries (Digital Twin + Knowledge Graph Slice 1,
 * ff_digital_twin_v1). Frontend-readiness-only: no notification of either
 * type is emitted while the flag is OFF; this suite pins that the page
 * RENDERS them correctly, bilingually, if/when one is present in the feed —
 * mirroring the existing type entries' coverage pattern (this file is the
 * first render test for src/app/notifications/page.tsx's TYPE_CONFIG map;
 * no prior test referenced these labels by string).
 *
 * Pins (read from the current TYPE_CONFIG source, not any earlier draft):
 *   prerequisite_blocked  → icon 🔗, label "Foundation Boost"  / "नींव अभ्यास"
 *   prerequisite_resolved → icon ✅, label "Foundation Ready"  / "नींव तैयार"
 */

import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

// ── next/navigation mock ─────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// ── AuthContext mock ──────────────────────────────────────────────────
const student = { id: 'stu-1', grade: '8' };
let mockIsHi = false;
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ student, isLoggedIn: true, isLoading: false, isHi: mockIsHi }),
}));

// ── Data layer mock ────────────────────────────────────────────────────
const getStudentNotifications = vi.fn();
vi.mock('@alfanumrik/lib/supabase', () => ({
  getStudentNotifications: (...args: unknown[]) => getStudentNotifications(...args),
  supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}));

const NOW = new Date().toISOString();

const BLOCKED_NOTIF = {
  id: 'n-blocked-1',
  type: 'prerequisite_blocked',
  title: 'Chapter 7 will click faster once Chapter 4 is solid',
  body: 'Strengthen Chapter 4 first — it unlocks faster progress in Chapter 7.',
  data: {},
  is_read: false,
  created_at: NOW,
};

const RESOLVED_NOTIF = {
  id: 'n-resolved-1',
  type: 'prerequisite_resolved',
  title: 'Chapter 4 is solid now',
  body: 'Nice work — Chapter 7 should feel easier from here.',
  data: {},
  is_read: false,
  created_at: NOW,
};

async function renderPage() {
  const { default: NotificationsPage } = await import('@/app/notifications/page');
  return render(React.createElement(NotificationsPage));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsHi = false;
});

afterEach(() => {
  cleanup();
});

describe('/notifications page — prerequisite_blocked / prerequisite_resolved (Loop D)', () => {
  it('renders prerequisite_blocked with the "Foundation Boost" EN label and 🔗 icon', async () => {
    getStudentNotifications.mockResolvedValueOnce({
      unread_count: 1,
      notifications: [BLOCKED_NOTIF],
    });
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText(BLOCKED_NOTIF.title)).toBeInTheDocument();
    });
    expect(screen.getByText('Foundation Boost')).toBeInTheDocument();
    expect(screen.getByText(/Strengthen Chapter 4 first/)).toBeInTheDocument();
    expect(screen.getByText('🔗')).toBeInTheDocument();
  });

  it('renders prerequisite_resolved with the "Foundation Ready" EN label and ✅ icon', async () => {
    getStudentNotifications.mockResolvedValueOnce({
      unread_count: 1,
      notifications: [RESOLVED_NOTIF],
    });
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText(RESOLVED_NOTIF.title)).toBeInTheDocument();
    });
    expect(screen.getByText('Foundation Ready')).toBeInTheDocument();
    expect(screen.getByText('✅')).toBeInTheDocument();
  });

  it('renders both types together, each keeping its own distinct icon/label', async () => {
    getStudentNotifications.mockResolvedValueOnce({
      unread_count: 2,
      notifications: [BLOCKED_NOTIF, RESOLVED_NOTIF],
    });
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText(BLOCKED_NOTIF.title)).toBeInTheDocument();
    });
    expect(screen.getByText('Foundation Boost')).toBeInTheDocument();
    expect(screen.getByText('Foundation Ready')).toBeInTheDocument();
  });

  it('renders Hindi labels ("नींव अभ्यास" / "नींव तैयार") when isHi=true (P7)', async () => {
    mockIsHi = true;
    getStudentNotifications.mockResolvedValueOnce({
      unread_count: 2,
      notifications: [BLOCKED_NOTIF, RESOLVED_NOTIF],
    });
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText(BLOCKED_NOTIF.title)).toBeInTheDocument();
    });
    expect(screen.getByText('नींव अभ्यास')).toBeInTheDocument();
    expect(screen.getByText('नींव तैयार')).toBeInTheDocument();
    // Numbers in the surrounding UI stay Arabic numerals even in Hindi mode
    // (unread count badge) — the badge renders the raw number, not a
    // Devanagari numeral.
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
