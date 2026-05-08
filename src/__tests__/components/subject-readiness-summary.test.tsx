import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const _isHi = { current: false };
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isHi: _isHi.current }),
}));

let _readinessResult: { readiness: unknown; isLoading: boolean; error: unknown; refresh: () => void } = {
  readiness: null,
  isLoading: false,
  error: null,
  refresh: vi.fn(),
};

vi.mock('@/lib/useSubjectReadiness', () => ({
  useSubjectReadiness: () => _readinessResult,
}));

function setReadiness(readiness: unknown) {
  _readinessResult = { readiness, isLoading: false, error: null, refresh: vi.fn() };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SubjectReadinessSummary: any;

beforeEach(async () => {
  vi.clearAllMocks();
  _isHi.current = false;
  setReadiness(null);
  const mod = await import('@/components/learn/SubjectReadinessSummary');
  SubjectReadinessSummary = mod.SubjectReadinessSummary;
});

describe('<SubjectReadinessSummary />', () => {
  it('hides when readiness is null', () => {
    setReadiness(null);
    const { container } = render(<SubjectReadinessSummary subjectCode="science" />);
    expect(container.firstChild).toBeNull();
  });

  it('hides when total is zero (subject has no chapters seeded)', () => {
    setReadiness({
      grade: '9',
      subject: 'science',
      chapters: [],
      summary: { ready: 0, almost: 0, building: 0, not_yet: 0 },
    });
    const { container } = render(<SubjectReadinessSummary subjectCode="science" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders summary banner with EN labels', () => {
    setReadiness({
      grade: '9',
      subject: 'science',
      chapters: [],
      summary: { ready: 3, almost: 2, building: 4, not_yet: 3 },
    });
    render(<SubjectReadinessSummary subjectCode="science" />);
    expect(screen.getByText(/Exam Readiness/)).toBeTruthy();
    expect(screen.getByText(/3\/12 chapters ready/)).toBeTruthy();
    expect(screen.getByText(/3 Ready/)).toBeTruthy();
    expect(screen.getByText(/2 Almost/)).toBeTruthy();
    expect(screen.getByText(/4 Building/)).toBeTruthy();
    expect(screen.getByText(/3 Not Yet/)).toBeTruthy();
  });

  it('renders summary in Hindi', () => {
    _isHi.current = true;
    setReadiness({
      grade: '9',
      subject: 'science',
      chapters: [],
      summary: { ready: 3, almost: 2, building: 0, not_yet: 0 },
    });
    render(<SubjectReadinessSummary subjectCode="science" />);
    expect(screen.getByText(/परीक्षा तैयारी/)).toBeTruthy();
    expect(screen.getByText(/3\/5 अध्याय तैयार/)).toBeTruthy();
  });

  it('hides empty buckets in the count row', () => {
    setReadiness({
      grade: '9',
      subject: 'science',
      chapters: [],
      summary: { ready: 5, almost: 0, building: 0, not_yet: 0 },
    });
    render(<SubjectReadinessSummary subjectCode="science" />);
    expect(screen.getByText(/5 Ready/)).toBeTruthy();
    expect(screen.queryByText(/Almost/)).toBeNull();
    expect(screen.queryByText(/Building/)).toBeNull();
    expect(screen.queryByText(/Not Yet/)).toBeNull();
  });

  it('shows celebratory message when all chapters are ready', () => {
    setReadiness({
      grade: '9',
      subject: 'science',
      chapters: [],
      summary: { ready: 12, almost: 0, building: 0, not_yet: 0 },
    });
    render(<SubjectReadinessSummary subjectCode="science" />);
    expect(screen.getByText(/Brilliant/)).toBeTruthy();
  });
});

describe('<ChapterReadinessBadge />', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ChapterReadinessBadge: any;

  beforeEach(async () => {
    const mod = await import('@/components/learn/ChapterReadinessBadge');
    ChapterReadinessBadge = mod.ChapterReadinessBadge;
  });

  it('hides when level is null', () => {
    const { container } = render(<ChapterReadinessBadge level={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders ready badge', () => {
    render(<ChapterReadinessBadge level="ready" />);
    expect(screen.getByTestId('chapter-readiness-badge-ready')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
  });

  it('renders all four levels distinctly', () => {
    const { rerender } = render(<ChapterReadinessBadge level="not_yet" />);
    expect(screen.getByText('New')).toBeTruthy();

    rerender(<ChapterReadinessBadge level="building" />);
    expect(screen.getByText('Building')).toBeTruthy();

    rerender(<ChapterReadinessBadge level="almost" />);
    expect(screen.getByText('Almost')).toBeTruthy();

    rerender(<ChapterReadinessBadge level="ready" />);
    expect(screen.getByText('Ready')).toBeTruthy();
  });

  it('renders Hindi labels', () => {
    _isHi.current = true;
    render(<ChapterReadinessBadge level="ready" />);
    expect(screen.getByText('तैयार')).toBeTruthy();
  });
});
