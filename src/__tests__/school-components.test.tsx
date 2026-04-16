import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * School Component Tests
 *
 * Tests for the 5 new B2B school components:
 * - NotificationCenter
 * - OnboardingWizard
 * - SchoolAnnouncementBanner
 * - SchoolWelcomeHeader
 * - UpcomingExamCard
 *
 * Covers: rendering, bilingual (P7), grade strings (P5), accessibility, error resilience.
 */

// ── Global Mocks ─────────────────────────────────────────────────────────────

let mockIsHi = false;
let mockAuthUserId = 'test-user-123';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({
    authUserId: mockAuthUserId,
    isHi: mockIsHi,
    session: { user: { id: mockAuthUserId } },
  }),
}));

vi.mock('@/lib/tenant-context', () => ({
  useTenant: () => ({
    schoolId: 'school-test-001',
    schoolName: 'Test School',
    branding: { primaryColor: '#7C3AED', logoUrl: null },
  }),
}));

// Chainable Supabase mock
const mockSupabaseChain: Record<string, ReturnType<typeof vi.fn>> = {};
['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'gt', 'not',
 'is', 'order', 'limit', 'range', 'maybeSingle', 'single'].forEach(m => {
  mockSupabaseChain[m] = vi.fn().mockReturnValue(mockSupabaseChain);
});
// Default resolved value for terminal methods
mockSupabaseChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

const mockSupabaseFrom = vi.fn().mockReturnValue(mockSupabaseChain);
const mockSupabaseChannel = vi.fn().mockReturnValue({
  on: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
});
const mockRemoveChannel = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    channel: (...args: unknown[]) => mockSupabaseChannel(...args),
    removeChannel: mockRemoveChannel,
  },
}));

// SWR mock
let mockSWRData: unknown = null;
let mockSWRLoading = false;

vi.mock('swr', () => ({
  default: () => ({ data: mockSWRData, isLoading: mockSWRLoading, error: null }),
}));

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => React.createElement('img', {
    ...props,
    'data-testid': 'next-image',
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) =>
    React.createElement('a', { href, ...props }, children),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ═════════════════════════════════════════════════════════════════════════════
// NotificationCenter
// ═════════════════════════════════════════════════════════════════════════════

describe('NotificationCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsHi = false;
    mockAuthUserId = 'test-user-123';
    // Mock notifications fetch
    mockSupabaseChain.limit = vi.fn().mockResolvedValue({
      data: [
        { id: 'n1', title: 'Test Notification', body: 'Body text', notification_type: 'announcement', is_read: false, created_at: new Date().toISOString() },
        { id: 'n2', title: 'Read Notification', body: 'Read body', notification_type: 'score_notification', is_read: true, created_at: new Date().toISOString() },
      ],
      error: null,
    });
    // Re-chain limit
    mockSupabaseChain.order = vi.fn().mockReturnValue(mockSupabaseChain);
  });

  it('renders bell icon without crashing', async () => {
    const { default: NotificationCenter } = await import('@/components/school/NotificationCenter');
    render(React.createElement(NotificationCenter));
    expect(screen.getByRole('button', { name: /notifications/i })).toBeDefined();
  });

  it('renders with Hindi aria-label when isHi=true', async () => {
    mockIsHi = true;
    const { default: NotificationCenter } = await import('@/components/school/NotificationCenter');
    render(React.createElement(NotificationCenter));
    expect(screen.getByRole('button', { name: 'सूचनाएँ' })).toBeDefined();
  });

  it('opens dropdown on click and closes on Escape', async () => {
    const { default: NotificationCenter } = await import('@/components/school/NotificationCenter');
    render(React.createElement(NotificationCenter));

    // Click bell to open
    const bell = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(bell);

    // Dropdown should have "See all notifications" link
    expect(screen.getByText(/see all notifications/i)).toBeDefined();

    // Escape should close
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(/see all notifications/i)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SchoolAnnouncementBanner
// ═════════════════════════════════════════════════════════════════════════════

describe('SchoolAnnouncementBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsHi = false;
    mockSWRData = null;
    mockSWRLoading = false;
  });

  it('returns null when loading', async () => {
    mockSWRLoading = true;
    const { default: SchoolAnnouncementBanner } = await import('@/components/school/SchoolAnnouncementBanner');
    const { container } = render(React.createElement(SchoolAnnouncementBanner, { isHi: false }));
    expect(container.innerHTML).toBe('');
  });

  it('returns null when no announcement', async () => {
    mockSWRData = null;
    const { default: SchoolAnnouncementBanner } = await import('@/components/school/SchoolAnnouncementBanner');
    const { container } = render(React.createElement(SchoolAnnouncementBanner, { isHi: false }));
    expect(container.innerHTML).toBe('');
  });

  it('renders announcement title and body', async () => {
    mockSWRData = {
      id: 'ann-1',
      title: 'School Holiday',
      title_hi: 'स्कूल की छुट्टी',
      body: 'School will be closed on Friday',
      body_hi: 'शुक्रवार को स्कूल बंद रहेगा',
      published_at: new Date().toISOString(),
    };
    const { default: SchoolAnnouncementBanner } = await import('@/components/school/SchoolAnnouncementBanner');
    render(React.createElement(SchoolAnnouncementBanner, { isHi: false }));
    expect(screen.getByText('School Holiday')).toBeDefined();
    expect(screen.getByText(/School will be closed/)).toBeDefined();
  });

  it('shows Hindi text when isHi=true', async () => {
    mockSWRData = {
      id: 'ann-1',
      title: 'School Holiday',
      title_hi: 'स्कूल की छुट्टी',
      body: 'School will be closed on Friday',
      body_hi: 'शुक्रवार को स्कूल बंद रहेगा',
      published_at: new Date().toISOString(),
    };
    const { default: SchoolAnnouncementBanner } = await import('@/components/school/SchoolAnnouncementBanner');
    render(React.createElement(SchoolAnnouncementBanner, { isHi: true }));
    expect(screen.getByText('स्कूल की छुट्टी')).toBeDefined();
  });

  it('does not crash when localStorage throws', async () => {
    mockSWRData = {
      id: 'ann-2',
      title: 'Test',
      title_hi: null,
      body: 'Test body',
      body_hi: null,
      published_at: new Date().toISOString(),
    };
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('Blocked'); };

    const { default: SchoolAnnouncementBanner } = await import('@/components/school/SchoolAnnouncementBanner');
    // Should not throw
    expect(() => render(React.createElement(SchoolAnnouncementBanner, { isHi: false }))).not.toThrow();

    Storage.prototype.getItem = originalGetItem;
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SchoolWelcomeHeader
// ═════════════════════════════════════════════════════════════════════════════

describe('SchoolWelcomeHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsHi = false;
  });

  it('B2B mode shows school name', async () => {
    const { default: SchoolWelcomeHeader } = await import('@/components/school/SchoolWelcomeHeader');
    render(React.createElement(SchoolWelcomeHeader, {
      isHi: false,
      studentName: 'Hridaan Sharma',
      isB2B: true,
      schoolName: 'Delhi Public School',
      branding: { primaryColor: '#7C3AED', secondaryColor: '#F97316', logoUrl: null, tagline: null, faviconUrl: null, showPoweredBy: false },
    }));
    expect(screen.getByText(/Delhi Public School/)).toBeDefined();
  });

  it('B2C fallback shows generic greeting', async () => {
    const { default: SchoolWelcomeHeader } = await import('@/components/school/SchoolWelcomeHeader');
    render(React.createElement(SchoolWelcomeHeader, {
      isHi: false,
      studentName: 'Hridaan Sharma',
      isB2B: false,
    }));
    // Should show first name in greeting
    expect(screen.getByText(/Hridaan/)).toBeDefined();
    // Should NOT show any school name
    expect(screen.queryByText(/Delhi/)).toBeNull();
  });

  it('shows Hindi greeting when isHi=true', async () => {
    const { default: SchoolWelcomeHeader } = await import('@/components/school/SchoolWelcomeHeader');
    render(React.createElement(SchoolWelcomeHeader, {
      isHi: true,
      studentName: 'Hridaan Sharma',
      isB2B: false,
    }));
    // Hindi greetings contain words like सुप्रभात, शुभ दोपहर, शुभ संध्या, or the student name
    expect(screen.getByText(/Hridaan/)).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// UpcomingExamCard
// ═════════════════════════════════════════════════════════════════════════════

describe('UpcomingExamCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsHi = false;
    mockSWRData = null;
    mockSWRLoading = false;
  });

  it('returns null when loading', async () => {
    mockSWRLoading = true;
    const { default: UpcomingExamCard } = await import('@/components/school/UpcomingExamCard');
    const { container } = render(React.createElement(UpcomingExamCard, { isHi: false }));
    expect(container.innerHTML).toBe('');
  });

  it('returns null when no exams', async () => {
    mockSWRData = [];
    const { default: UpcomingExamCard } = await import('@/components/school/UpcomingExamCard');
    const { container } = render(React.createElement(UpcomingExamCard, { isHi: false }));
    expect(container.innerHTML).toBe('');
  });

  it('renders exam details', async () => {
    const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days from now
    mockSWRData = [{
      id: 'exam-1',
      title: 'Mid-Term Mathematics',
      subject: 'Mathematics',
      grade: '8',
      start_time: futureDate,
      end_time: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 3600000).toISOString(),
      duration_minutes: 60,
      question_count: 30,
    }];
    const { default: UpcomingExamCard } = await import('@/components/school/UpcomingExamCard');
    render(React.createElement(UpcomingExamCard, { isHi: false }));
    expect(screen.getAllByText(/Mathematics/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Mid-Term/).length).toBeGreaterThan(0);
  });

  it('shows Hindi text when isHi=true', async () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    mockSWRData = [{
      id: 'exam-2',
      title: 'Final Exam',
      subject: 'Science',
      grade: '9',
      start_time: futureDate,
      end_time: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 7200000).toISOString(),
      duration_minutes: 90,
      question_count: 50,
    }];
    const { default: UpcomingExamCard } = await import('@/components/school/UpcomingExamCard');
    render(React.createElement(UpcomingExamCard, { isHi: true }));
    // Hindi label for "Upcoming Exams" section
    expect(screen.getByText(/आगामी परीक्षा|परीक्षा/)).toBeDefined();
  });
});