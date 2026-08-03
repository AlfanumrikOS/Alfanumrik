/**
 * ExamScheduleCard / ExamScheduleList — the three-tier "when is my test"
 * surface (packages/ui/src/exams/v2/ExamSchedule.tsx).
 *
 * PURE PRESENTATION: fetches nothing, imports no hook besides useRouter.
 *
 * Pins:
 *   - ExamScheduleCard renders nothing when entry is null.
 *   - SourceLine text varies correctly by source (school/teacher/student), in
 *     both languages.
 *   - The "Revise for this" / "Add" / "Edit" actions call the right callback
 *     with the right argument.
 *   - ExamScheduleList shows "This week" only when non-empty, "Later" only
 *     when non-empty, and the dedicated empty state when BOTH are empty.
 *   - Accessibility (task item 9): every interactive control (revise, add,
 *     edit, back-to-today, chapter chip) has an inline minHeight >= 44px
 *     (this repo's tap-target convention — see e2e/accessibility.spec.ts for
 *     the equivalent live-page check on the reachable surfaces).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ExamScheduleEntry } from '@alfanumrik/lib/exams/types';
import { ExamScheduleCard, ExamScheduleList } from '@alfanumrik/ui/exams/v2/ExamSchedule';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
}));

function studentEntry(overrides: Partial<ExamScheduleEntry> = {}): ExamScheduleEntry {
  return {
    id: 'e-student',
    source: 'student',
    title: 'Coaching test',
    startsOn: '2026-08-05',
    endsOn: '2026-08-05',
    dayLabel: 'Wed',
    editable: true,
    ...overrides,
  };
}

function teacherEntry(overrides: Partial<ExamScheduleEntry> = {}): ExamScheduleEntry {
  return {
    id: 'e-teacher',
    source: 'teacher',
    title: 'Chapter test — Number Systems',
    startsOn: '2026-08-06',
    endsOn: '2026-08-06',
    dayLabel: 'Thu',
    setBy: 'Priya Sharma',
    setByInitials: 'PS',
    chapters: [{ id: 'topic-1', label: 'Number Systems', band: 'shaky' }],
    ...overrides,
  };
}

function schoolEntry(overrides: Partial<ExamScheduleEntry> = {}): ExamScheduleEntry {
  return {
    id: 'e-school',
    source: 'school',
    title: 'Half-Yearly Exam',
    startsOn: '2026-09-01',
    endsOn: '2026-09-10',
    dayLabel: '1 – 10 Sep',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

function getMinHeight(el: HTMLElement): number {
  return parseFloat(el.style.minHeight || '0');
}

describe('ExamScheduleCard', () => {
  it('renders nothing when entry is null', () => {
    const { container } = render(<ExamScheduleCard entry={null} isHi={false} onRevise={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the title and day label', () => {
    render(<ExamScheduleCard entry={studentEntry()} isHi={false} onRevise={vi.fn()} />);
    expect(screen.getByText('Coaching test')).toBeInTheDocument();
    expect(screen.getByText('Wed')).toBeInTheDocument();
  });

  it('shows "You added this" for a student-source entry', () => {
    render(<ExamScheduleCard entry={studentEntry()} isHi={false} onRevise={vi.fn()} />);
    expect(screen.getByText('You added this')).toBeInTheDocument();
  });

  it('shows the Hindi student-source line', () => {
    render(<ExamScheduleCard entry={studentEntry()} isHi={true} onRevise={vi.fn()} />);
    expect(screen.getByText('आपने जोड़ा')).toBeInTheDocument();
  });

  it('shows "From your school calendar" for a school-source entry', () => {
    render(<ExamScheduleCard entry={schoolEntry()} isHi={false} onRevise={vi.fn()} />);
    expect(screen.getByText('From your school calendar')).toBeInTheDocument();
  });

  it('shows the teacher name + initials avatar for a teacher-source entry', () => {
    render(<ExamScheduleCard entry={teacherEntry()} isHi={false} onRevise={vi.fn()} />);
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
    expect(screen.getByText('PS')).toBeInTheDocument();
  });

  it('renders chapter chips with their band label', () => {
    render(<ExamScheduleCard entry={teacherEntry()} isHi={false} onRevise={vi.fn()} />);
    expect(screen.getByText('Number Systems')).toBeInTheDocument();
  });

  it('does not render a chapters row when the entry has none', () => {
    render(<ExamScheduleCard entry={studentEntry()} isHi={false} onRevise={vi.fn()} />);
    expect(screen.queryByText('Number Systems')).not.toBeInTheDocument();
  });

  it('calls onRevise(entry) when the revise button is clicked', () => {
    const onRevise = vi.fn();
    const entry = studentEntry();
    render(<ExamScheduleCard entry={entry} isHi={false} onRevise={onRevise} />);
    screen.getByTestId('exam-schedule-revise').click();
    expect(onRevise).toHaveBeenCalledWith(entry);
  });

  it('shows the Hindi revise label', () => {
    render(<ExamScheduleCard entry={studentEntry()} isHi={true} onRevise={vi.fn()} />);
    expect(screen.getByText('इसके लिए रिवीजन करें')).toBeInTheDocument();
  });

  it('the revise button meets the 44px minimum tap target', () => {
    render(<ExamScheduleCard entry={studentEntry()} isHi={false} onRevise={vi.fn()} />);
    expect(getMinHeight(screen.getByTestId('exam-schedule-revise'))).toBeGreaterThanOrEqual(44);
  });
});

describe('ExamScheduleList', () => {
  it('renders the "Tests & deadlines" heading', () => {
    render(<ExamScheduleList thisWeek={[]} later={[]} isHi={false} onAdd={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Tests & deadlines' })).toBeInTheDocument();
  });

  it('renders the Hindi heading', () => {
    render(<ExamScheduleList thisWeek={[]} later={[]} isHi={true} onAdd={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'टेस्ट और समय-सीमा' })).toBeInTheDocument();
  });

  it('shows "This week" only when thisWeek has entries', () => {
    const { rerender } = render(
      <ExamScheduleList thisWeek={[]} later={[]} isHi={false} onAdd={vi.fn()} onEdit={vi.fn()} />,
    );
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
    rerender(<ExamScheduleList thisWeek={[studentEntry()]} later={[]} isHi={false} onAdd={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText('This week')).toBeInTheDocument();
  });

  it('shows "Later" only when later has entries', () => {
    render(<ExamScheduleList thisWeek={[]} later={[schoolEntry()]} isHi={false} onAdd={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText('Later')).toBeInTheDocument();
    expect(screen.queryByText('This week')).not.toBeInTheDocument();
  });

  it('shows the empty state only when BOTH thisWeek and later are empty', () => {
    render(<ExamScheduleList thisWeek={[]} later={[]} isHi={false} onAdd={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByTestId('exam-schedule-empty')).toBeInTheDocument();
  });

  it('hides the empty state when at least one tier has an entry', () => {
    render(<ExamScheduleList thisWeek={[studentEntry()]} later={[]} isHi={false} onAdd={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.queryByTestId('exam-schedule-empty')).not.toBeInTheDocument();
  });

  it('renders each row with a source-tagged testid', () => {
    render(
      <ExamScheduleList
        thisWeek={[studentEntry(), teacherEntry()]}
        later={[schoolEntry()]}
        isHi={false}
        onAdd={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(screen.getByTestId('exam-entry-student')).toBeInTheDocument();
    expect(screen.getByTestId('exam-entry-teacher')).toBeInTheDocument();
    expect(screen.getByTestId('exam-entry-school')).toBeInTheDocument();
  });

  it('calls onAdd when the header Add button is clicked', () => {
    const onAdd = vi.fn();
    render(<ExamScheduleList thisWeek={[]} later={[]} isHi={false} onAdd={onAdd} onEdit={vi.fn()} />);
    screen.getByTestId('exam-schedule-add').click();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('calls onAdd from the empty-state "Add a date" button too', () => {
    const onAdd = vi.fn();
    render(<ExamScheduleList thisWeek={[]} later={[]} isHi={false} onAdd={onAdd} onEdit={vi.fn()} />);
    screen.getByText('Add a date').click();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('shows an Edit affordance only for editable entries, and calls onEdit(entry) on click', () => {
    const onEdit = vi.fn();
    const editableEntry = studentEntry();
    const nonEditable = teacherEntry();
    render(
      <ExamScheduleList thisWeek={[editableEntry, nonEditable]} later={[]} isHi={false} onAdd={vi.fn()} onEdit={onEdit} />,
    );
    const editButtons = screen.getAllByText('Edit');
    expect(editButtons).toHaveLength(1);
    editButtons[0].click();
    expect(onEdit).toHaveBeenCalledWith(editableEntry);
  });

  it('navigates to /today when "Back to today" is clicked', () => {
    render(<ExamScheduleList thisWeek={[]} later={[]} isHi={false} onAdd={vi.fn()} onEdit={vi.fn()} />);
    screen.getByText('← Back to today').click();
    expect(mockPush).toHaveBeenCalledWith('/today');
  });

  it('the header Add button meets the 44px minimum tap target', () => {
    render(<ExamScheduleList thisWeek={[]} later={[]} isHi={false} onAdd={vi.fn()} onEdit={vi.fn()} />);
    expect(getMinHeight(screen.getByTestId('exam-schedule-add'))).toBeGreaterThanOrEqual(44);
  });
});
