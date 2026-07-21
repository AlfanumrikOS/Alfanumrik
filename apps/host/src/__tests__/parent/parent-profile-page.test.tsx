import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ParentProfilePage from '@/app/parent/profile/page';

// Regression coverage for parent-dashboard RCA Task 3.3 (2026-07-20):
// /parent/profile was rebuilt on Tailwind + semantic tokens (previously
// 100% inline style={{}} with a green #16A34A brand color used nowhere
// else in the documented palette). This is a presentational-only
// refactor -- these tests exist to prove the business logic (validation,
// the guardians.update() write, sign-out) still works identically, since
// no render test previously existed for this page at all.

const routerPush = vi.fn();
const routerReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}));

const signOut = vi.fn();
const authState = vi.hoisted(() => ({
  guardian: { id: 'guardian-1', name: 'Pradeep Sharma', email: 'pradeep@example.com', phone: '+919999999999' },
  isLoggedIn: true,
  isLoading: false,
  activeRole: 'guardian',
  isHi: false,
}));
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => ({ ...authState, signOut }),
}));

const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
const updateMock = vi.fn(() => ({ eq: updateEq }));
vi.mock('@alfanumrik/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({ update: updateMock })),
  },
}));

describe('/parent/profile — Tailwind refactor preserves business logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders profile details from guardian props (view mode)', () => {
    render(<ParentProfilePage />);
    // Name appears twice by design (header h1 + Profile Details card).
    expect(screen.getAllByText('Pradeep Sharma').length).toBeGreaterThanOrEqual(2);
    // Email also appears twice (header subtitle + Profile Details card).
    expect(screen.getAllByText('pradeep@example.com').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('+919999999999')).toBeInTheDocument();
  });

  it('enters edit mode and rejects an invalid (too-short) name', async () => {
    render(<ParentProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Name must be 2-100 characters');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid phone number', async () => {
    render(<ParentProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pradeep Sharma' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a valid phone number');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('saves valid changes via supabase.from(guardians).update().eq(id) and shows success toast', async () => {
    render(<ParentProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pradeep S.' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+919876543210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateEq).toHaveBeenCalledWith('id', 'guardian-1'));
    expect(updateMock).toHaveBeenCalledWith({ name: 'Pradeep S.', phone: '+919876543210' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Profile updated!');
  });

  it('signs out and redirects to /login', async () => {
    render(<ParentProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(routerReplace).toHaveBeenCalledWith('/login');
  });

  it('renders Hindi copy when isHi is true (P7)', () => {
    authState.isHi = true;
    render(<ParentProfilePage />);
    expect(screen.getByText('प्रोफ़ाइल विवरण')).toBeInTheDocument();
    authState.isHi = false;
  });
});
