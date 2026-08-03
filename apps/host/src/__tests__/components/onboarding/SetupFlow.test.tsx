/**
 * SetupFlow — screen 01 "Set up" (packages/ui/src/onboarding/v2/SetupFlow.tsx).
 *
 * PRESENTATION ONLY: every read is a prop, every write is a callback (see
 * that file's header for the full DPDP minor-gate reasoning). Pins:
 *
 *   - 4 steps for a minor: welcome → class → subjects → parent.
 *   - 3 steps (parent skipped) for a non-minor: welcome → class → subjects → finish.
 *   - class step: grade required before onSaveGrade fires; onGradeSaved
 *     called after a successful save.
 *   - subjects step: renders only UNLOCKED subjects; at least one must be
 *     selected before onSaveSubjects fires; the first selected code becomes
 *     the preferred subject.
 *   - parent step: FINISH is blocked until the email is syntactically valid
 *     (states: saving, parent-email invalid) — this does NOT wait on the
 *     guardian actually granting consent (see file header).
 *   - onComplete fires only after the terminal onFinish resolves ok.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Subject } from '@alfanumrik/lib/subjects.types';
import SetupFlow, { type SetupFlowProps } from '@alfanumrik/ui/onboarding/v2/SetupFlow';

const SUBJECTS: Subject[] = [
  { code: 'math', name: 'Mathematics', nameHi: 'गणित', icon: '∑', color: '#000', subjectKind: 'cbse_core', isCore: true, isLocked: false },
  { code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '🔬', color: '#000', subjectKind: 'cbse_core', isCore: true, isLocked: false },
  { code: 'jee_advanced', name: 'JEE Advanced', nameHi: 'JEE एडवांस्ड', icon: '🎯', color: '#000', subjectKind: 'platform_elective', isCore: false, isLocked: true },
];

function baseProps(overrides: Partial<SetupFlowProps> = {}): SetupFlowProps {
  return {
    isHi: false,
    studentName: 'Aarav',
    initialGrade: '',
    initialBoard: 'CBSE',
    subjects: SUBJECTS,
    subjectsLoading: false,
    isMinor: false,
    existingParentEmail: null,
    saving: false,
    onSaveGrade: vi.fn().mockResolvedValue({ ok: true }),
    onSaveSubjects: vi.fn().mockResolvedValue({ ok: true }),
    onInviteGuardian: vi.fn().mockResolvedValue({ ok: true }),
    onFinish: vi.fn().mockResolvedValue({ ok: true }),
    onGradeSaved: vi.fn(),
    onComplete: vi.fn(),
    ...overrides,
  };
}

async function advanceToClass() {
  fireEvent.click(screen.getByTestId('setup-welcome-continue'));
  await screen.findByTestId('setup-step-class');
}

async function advanceToSubjects(grade = '9') {
  await advanceToClass();
  fireEvent.change(screen.getByLabelText('Grade'), { target: { value: grade } });
  fireEvent.click(screen.getByTestId('setup-class-continue'));
  await screen.findByTestId('setup-step-subjects');
}

describe('SetupFlow — step order', () => {
  it('starts on welcome and only shows the locked subject as unselectable (not rendered)', async () => {
    render(<SetupFlow {...baseProps()} />);
    expect(screen.getByTestId('setup-step-welcome')).toBeInTheDocument();

    await advanceToSubjects();
    expect(screen.getByTestId('setup-subject-math')).toBeInTheDocument();
    expect(screen.getByTestId('setup-subject-science')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-subject-jee_advanced')).not.toBeInTheDocument();
  });

  it('non-minor: subjects → Finish skips the parent step entirely', async () => {
    const onSaveSubjects = vi.fn().mockResolvedValue({ ok: true });
    const onFinish = vi.fn().mockResolvedValue({ ok: true });
    const onComplete = vi.fn();
    render(<SetupFlow {...baseProps({ isMinor: false, onSaveSubjects, onFinish, onComplete })} />);

    await advanceToSubjects();
    fireEvent.click(screen.getByTestId('setup-subject-math'));
    fireEvent.click(screen.getByTestId('setup-subjects-continue'));

    await waitFor(() => expect(onSaveSubjects).toHaveBeenCalledWith(['math'], 'math'));
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(screen.queryByTestId('setup-step-parent')).not.toBeInTheDocument();
  });

  it('minor: subjects → Continue advances to the parent step instead of finishing', async () => {
    const onFinish = vi.fn().mockResolvedValue({ ok: true });
    render(<SetupFlow {...baseProps({ isMinor: true, onFinish })} />);

    await advanceToSubjects();
    fireEvent.click(screen.getByTestId('setup-subject-math'));
    fireEvent.click(screen.getByTestId('setup-subjects-continue'));

    await screen.findByTestId('setup-step-parent');
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe('SetupFlow — class step', () => {
  it('does not save without a grade selected (Continue stays disabled)', async () => {
    const onSaveGrade = vi.fn();
    render(<SetupFlow {...baseProps({ onSaveGrade })} />);
    await advanceToClass();
    expect(screen.getByTestId('setup-class-continue')).toBeDisabled();
    expect(onSaveGrade).not.toHaveBeenCalled();
  });

  it('calls onSaveGrade with the bare grade string + board, then onGradeSaved, then advances', async () => {
    const onSaveGrade = vi.fn().mockResolvedValue({ ok: true });
    const onGradeSaved = vi.fn();
    render(<SetupFlow {...baseProps({ onSaveGrade, onGradeSaved })} />);
    await advanceToClass();
    fireEvent.change(screen.getByLabelText('Grade'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('setup-class-continue'));

    await waitFor(() => expect(onSaveGrade).toHaveBeenCalledWith('10', 'CBSE'));
    await waitFor(() => expect(onGradeSaved).toHaveBeenCalled());
    await screen.findByTestId('setup-step-subjects');
  });

  it('shows an inline error and does not advance when the save fails', async () => {
    const onSaveGrade = vi.fn().mockResolvedValue({ ok: false, error: 'db down' });
    render(<SetupFlow {...baseProps({ onSaveGrade })} />);
    await advanceToClass();
    fireEvent.change(screen.getByLabelText('Grade'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('setup-class-continue'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByTestId('setup-step-class')).toBeInTheDocument();
  });
});

describe('SetupFlow — subjects step', () => {
  it('blocks continue with an inline error when nothing is selected', async () => {
    const onSaveSubjects = vi.fn();
    render(<SetupFlow {...baseProps({ onSaveSubjects })} />);
    await advanceToSubjects();
    fireEvent.click(screen.getByTestId('setup-subjects-continue'));

    expect(await screen.findByRole('alert')).toHaveTextContent('at least one subject');
    expect(onSaveSubjects).not.toHaveBeenCalled();
  });

  it('shows a loading skeleton while subjects are still resolving', async () => {
    render(<SetupFlow {...baseProps({ subjectsLoading: true, subjects: [] })} />);
    await advanceToClass();
    fireEvent.change(screen.getByLabelText('Grade'), { target: { value: '9' } });
    fireEvent.click(screen.getByTestId('setup-class-continue'));
    await screen.findByTestId('setup-step-subjects');
    expect(screen.getByTestId('setup-subjects-loading')).toBeInTheDocument();
  });
});

describe('SetupFlow — parent step (minor only)', () => {
  function toParentStep(props: Partial<SetupFlowProps> = {}) {
    return render(<SetupFlow {...baseProps({ isMinor: true, ...props })} />);
  }

  it('pre-fills the email captured at signup and does not block finish on it', async () => {
    const onInviteGuardian = vi.fn().mockResolvedValue({ ok: true });
    const onFinish = vi.fn().mockResolvedValue({ ok: true });
    const onComplete = vi.fn();
    toParentStep({ existingParentEmail: 'guardian@example.com', onInviteGuardian, onFinish, onComplete });

    await advanceToSubjects();
    fireEvent.click(screen.getByTestId('setup-subject-math'));
    fireEvent.click(screen.getByTestId('setup-subjects-continue'));
    await screen.findByTestId('setup-step-parent');

    expect(screen.getByTestId('setup-parent-email-input')).toHaveValue('guardian@example.com');
    fireEvent.click(screen.getByTestId('setup-parent-finish'));

    await waitFor(() => expect(onInviteGuardian).toHaveBeenCalledWith('guardian@example.com', 'en'));
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('state: parent-email invalid — blocks finish and shows the inline error', async () => {
    const onInviteGuardian = vi.fn();
    toParentStep({ existingParentEmail: null, onInviteGuardian });

    await advanceToSubjects();
    fireEvent.click(screen.getByTestId('setup-subject-math'));
    fireEvent.click(screen.getByTestId('setup-subjects-continue'));
    await screen.findByTestId('setup-step-parent');

    fireEvent.change(screen.getByTestId('setup-parent-email-input'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByTestId('setup-parent-finish'));

    expect(await screen.findByTestId('setup-parent-email-invalid')).toBeInTheDocument();
    expect(onInviteGuardian).not.toHaveBeenCalled();
  });

  it('state: saving — the finish button reflects the in-flight save', async () => {
    // Navigate with saving:false first (a `saving:true` flag from the start
    // would also disable the class/subjects step buttons, since `saving` is
    // one shared in-flight flag for whichever step is currently writing) —
    // then flip to saving:true once on the parent step, which is the state
    // this test actually pins.
    const { rerender } = toParentStep({ existingParentEmail: 'g@x.com' });
    await advanceToSubjects();
    fireEvent.click(screen.getByTestId('setup-subject-math'));
    fireEvent.click(screen.getByTestId('setup-subjects-continue'));
    await screen.findByTestId('setup-step-parent');

    rerender(<SetupFlow {...baseProps({ isMinor: true, existingParentEmail: 'g@x.com', saving: true })} />);

    expect(screen.getByTestId('setup-parent-finish')).toHaveTextContent('Sending...');
  });
});

describe('SetupFlow — bilingual', () => {
  it('renders Hindi copy end-to-end when isHi is true', () => {
    render(<SetupFlow {...baseProps({ isHi: true })} />);
    expect(screen.getByTestId('setup-welcome-continue')).toHaveTextContent('शुरू करें');
  });
});
