/**
 * ProfileScreen — screen 16 "Me" (packages/ui/src/profile/v2/ProfileScreen.tsx).
 *
 * PRESENTATION ONLY: every read is a prop, every write is a callback. Pins:
 *
 *   - three states: loading (Skeleton), error (EmptyState + retry callback),
 *     empty (`student: null` → EmptyState), loaded.
 *   - the streak renders SMALL, inside the identity header — not a
 *     standalone hero (SCREENS.md 16: "the streak lives here, small").
 *   - language switching calls onChangeLanguage with the OTHER language and
 *     never renders untranslated (isHi) English/Hindi mixed copy.
 *   - the "your data" card wires Export to a callback; there is no
 *     self-service account-deletion entry point here.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Subject } from '@alfanumrik/lib/subjects.types';
import ProfileScreen, { type ProfileScreenProps } from '@alfanumrik/ui/profile/v2/ProfileScreen';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const SELECTED_SUBJECTS: Subject[] = [
  { code: 'math', name: 'Mathematics', nameHi: 'गणित', icon: '∑', color: '#000', subjectKind: 'cbse_core', isCore: true, isLocked: false },
];

function baseProps(overrides: Partial<ProfileScreenProps> = {}): ProfileScreenProps {
  return {
    isHi: false,
    loading: false,
    error: false,
    onRetry: vi.fn(),
    student: {
      name: 'Aarav Sharma',
      grade: '9',
      board: 'CBSE',
      schoolName: 'DAV Public School',
      city: 'Delhi',
      state: 'Delhi',
      subscriptionPlan: 'free',
      parentName: null,
      parentPhone: null,
      memberSince: 'Jan 2026',
    },
    stats: { totalXp: 1250, streak: 4, mastered: 6, quizzesTaken: 21 },
    selectedSubjects: SELECTED_SUBJECTS,
    language: 'en',
    languageSaving: false,
    onChangeLanguage: vi.fn(),
    parentLinkCode: 'AB12CD',
    parentLinkCodeLoading: false,
    downloadsCount: 2,
    savedExplanationsCount: 3,
    exporting: false,
    onExportData: vi.fn(),
    onSignOut: vi.fn(),
    editProfileHref: '/profile',
    pricingHref: '/pricing',
    ...overrides,
  };
}

describe('ProfileScreen — three states', () => {
  it('loading: renders the skeleton, nothing else', () => {
    render(<ProfileScreen {...baseProps({ loading: true })} />);
    expect(screen.getByTestId('me-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('me-identity')).not.toBeInTheDocument();
  });

  it('error: renders EmptyState with a retry action wired to onRetry', () => {
    const onRetry = vi.fn();
    render(<ProfileScreen {...baseProps({ error: true, onRetry })} />);
    expect(screen.getByTestId('me-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('empty: student null renders EmptyState, not a crash', () => {
    render(<ProfileScreen {...baseProps({ student: null })} />);
    expect(screen.getByTestId('me-empty')).toBeInTheDocument();
  });

  it('loaded: renders identity, stats, and settings list', () => {
    render(<ProfileScreen {...baseProps()} />);
    expect(screen.getByTestId('me-loaded')).toBeInTheDocument();
    expect(screen.getByTestId('me-identity')).toHaveTextContent('Aarav Sharma');
    expect(screen.getByTestId('me-settings-list')).toBeInTheDocument();
  });
});

describe('ProfileScreen — streak placement (SCREENS.md 16)', () => {
  it('renders the streak small, inside the identity header, not as its own hero section', () => {
    render(<ProfileScreen {...baseProps({ stats: { totalXp: 500, streak: 7, mastered: 1, quizzesTaken: 3 } })} />);
    const identity = screen.getByTestId('me-identity');
    const streak = screen.getByTestId('me-streak');
    expect(identity).toContainElement(streak);
    expect(streak).toHaveTextContent('7');
  });
});

describe('ProfileScreen — language switching (P7, real from day one)', () => {
  it('calls onChangeLanguage("hi") when Hindi is tapped while English is active', () => {
    const onChangeLanguage = vi.fn();
    render(<ProfileScreen {...baseProps({ language: 'en', onChangeLanguage })} />);
    fireEvent.click(screen.getByTestId('me-lang-hi'));
    expect(onChangeLanguage).toHaveBeenCalledWith('hi');
  });

  it('calls onChangeLanguage("en") when English is tapped while Hindi is active', () => {
    const onChangeLanguage = vi.fn();
    render(<ProfileScreen {...baseProps({ language: 'hi', isHi: true, onChangeLanguage })} />);
    fireEvent.click(screen.getByTestId('me-lang-en'));
    expect(onChangeLanguage).toHaveBeenCalledWith('en');
  });

  it('disables both language buttons while a save is in flight', () => {
    render(<ProfileScreen {...baseProps({ languageSaving: true })} />);
    expect(screen.getByTestId('me-lang-en')).toBeDisabled();
    expect(screen.getByTestId('me-lang-hi')).toBeDisabled();
  });

  it('renders every visible string in Hindi when isHi is true (spot-check headings)', () => {
    render(<ProfileScreen {...baseProps({ isHi: true })} />);
    expect(screen.getByRole('heading', { name: 'मैं' })).toBeInTheDocument();
    expect(screen.getByTestId('me-row-language')).toHaveTextContent('भाषा');
  });
});

describe('ProfileScreen — your data (DPDP)', () => {
  it('wires Export to onExportData and shows the in-flight label', () => {
    const onExportData = vi.fn();
    const { rerender } = render(<ProfileScreen {...baseProps({ onExportData })} />);
    fireEvent.click(screen.getByTestId('me-export-data'));
    expect(onExportData).toHaveBeenCalledTimes(1);

    rerender(<ProfileScreen {...baseProps({ onExportData, exporting: true })} />);
    expect(screen.getByTestId('me-export-data')).toHaveTextContent('Downloading...');
  });
});

describe('ProfileScreen — settings list content', () => {
  it('summarizes grade + selected subjects and links Class & subjects to the real edit surface', () => {
    render(<ProfileScreen {...baseProps()} />);
    const row = screen.getByTestId('me-row-class-subjects');
    expect(row).toHaveTextContent('Grade 9');
    expect(row).toHaveTextContent('Mathematics');
    expect(row.closest('a')).toHaveAttribute('href', '/profile');
  });

  it('shows the parent link code with a working copy button when no parent is linked yet', () => {
    render(<ProfileScreen {...baseProps()} />);
    expect(screen.getByTestId('me-row-parent')).toHaveTextContent('AB12CD');
    expect(screen.getByTestId('me-parent-copy')).toBeInTheDocument();
  });

  it('shows the linked parent name instead of the code once a parent is linked', () => {
    render(
      <ProfileScreen
        {...baseProps({
          student: { ...baseProps().student!, parentName: 'Mrs. Sharma' },
        })}
      />,
    );
    expect(screen.getByTestId('me-row-parent')).toHaveTextContent('Mrs. Sharma');
  });

  it('summarizes offline downloads and saved Foxy answers (design 14 substrate, no new mechanism)', () => {
    render(<ProfileScreen {...baseProps({ downloadsCount: 2, savedExplanationsCount: 3 })} />);
    expect(screen.getByTestId('me-row-downloads')).toHaveTextContent('2 chapters offline');
    expect(screen.getByTestId('me-row-downloads')).toHaveTextContent('3 saved answers');
  });

  it('shows the plan badge and links Plan to pricing', () => {
    render(<ProfileScreen {...baseProps()} />);
    const row = screen.getByTestId('me-row-plan');
    expect(row.closest('a')).toHaveAttribute('href', '/pricing');
  });
});

describe('ProfileScreen — Plan row PlanModal trigger (ff_plan_v2, optional)', () => {
  it('defaults (no planModalEnabled/onOpenPlan passed): still a plain Link to pricingHref, unchanged', () => {
    render(<ProfileScreen {...baseProps()} />);
    const row = screen.getByTestId('me-row-plan');
    expect(row.closest('a')).toHaveAttribute('href', '/pricing');
    expect(row.closest('button')).toBeNull();
  });

  it('planModalEnabled=false with onOpenPlan provided: still links to pricingHref, never opens the modal', () => {
    const onOpenPlan = vi.fn();
    render(<ProfileScreen {...baseProps({ planModalEnabled: false, onOpenPlan })} />);
    const row = screen.getByTestId('me-row-plan');
    expect(row.closest('a')).toHaveAttribute('href', '/pricing');
  });

  it('planModalEnabled=true + onOpenPlan provided: Plan row becomes a button that calls onOpenPlan, not a Link', () => {
    const onOpenPlan = vi.fn();
    render(<ProfileScreen {...baseProps({ planModalEnabled: true, onOpenPlan })} />);
    const row = screen.getByTestId('me-row-plan');
    expect(row.closest('a')).toBeNull();
    fireEvent.click(row.closest('button')!);
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
  });
});

describe('ProfileScreen — sign out', () => {
  it('wires the sign-out button to onSignOut', () => {
    const onSignOut = vi.fn();
    render(<ProfileScreen {...baseProps({ onSignOut })} />);
    fireEvent.click(screen.getByTestId('me-sign-out'));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
