'use client';

/**
 * Student profile edit form for the Users DetailDrawer.
 *
 * Field set matches the ACTUAL `allowedFields` map in
 * apps/host/src/app/api/super-admin/users/route.ts (PATCH), not the
 * task's prose description of it — the route only allows
 * `students: ['is_active', 'account_status', 'subscription_plan', 'grade', 'board']`.
 * `teachers`/`guardians` only allow `is_active` (already covered by the
 * existing Ban/Unban control), so this form only renders for role==='student'.
 *
 * `school_admins` (name/email/phone/is_active/school_id) and `admin_users`
 * (name/is_active/admin_level) are also PATCH-able per the route, but
 * neither table is reachable through GET /api/super-admin/users — the role
 * param only maps to students/teachers/guardians (verified in the route:
 * unmapped roles silently fall through to `students`). Wiring those requires
 * a backend change to the GET route; flagged in the handoff, not built here
 * to avoid inventing an API call that doesn't exist.
 *
 * P5: grade is always a string ("6".."12"), never coerced to a number.
 */

import { useEffect, useState } from 'react';
import { GRADES, BOARDS } from '@alfanumrik/lib/constants';
import { toast } from '@alfanumrik/ui/ui/toast';
import { readAdminJson } from '../../_components/AdminShell';

// Exact enum from the PATCH schema's `subscription_plan` field
// (apps/host/src/app/api/super-admin/users/route.ts). Keep in sync — do not
// guess. NOTE: this differs from the (looser) `VALID_PLANS` list the GET
// handler in the same file uses for its own `?plan=` filter; that mismatch
// is a pre-existing API inconsistency, not something to paper over here.
const SUBSCRIPTION_PLANS = [
  'free',
  'starter', 'starter_monthly', 'starter_yearly',
  'pro', 'pro_monthly', 'pro_yearly',
  'ultimate_monthly', 'ultimate_yearly',
  'unlimited', 'unlimited_monthly', 'unlimited_yearly',
  'basic', 'premium',
] as const;

const GRADE_LIST: readonly string[] = GRADES;
const BOARD_LIST: readonly string[] = BOARDS;
const PLAN_LIST: readonly string[] = SUBSCRIPTION_PLANS;

/** Ensures the currently-stored value always has a matching <option>, even
 * if it's outside the known list (legacy/free-text data) — prevents the
 * native <select> desyncing from React state when it can't find a match. */
function withCurrentValue(list: readonly string[], current: string): readonly string[] {
  return current && !list.includes(current) ? [current, ...list] : list;
}

export interface EditProfileFormProps {
  userId: string;
  grade?: string;
  board?: string;
  subscriptionPlan?: string;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  isHi: boolean;
  onSaved: (updates: { grade?: string; board?: string; subscription_plan?: string }) => void;
}

export default function EditProfileForm({
  userId, grade, board, subscriptionPlan, apiFetch, isHi, onSaved,
}: EditProfileFormProps) {
  const [gradeVal, setGradeVal] = useState(grade || '');
  const [boardVal, setBoardVal] = useState(board || '');
  const [planVal, setPlanVal] = useState(subscriptionPlan || 'free');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGradeVal(grade || '');
    setBoardVal(board || '');
    setPlanVal(subscriptionPlan || 'free');
    setError(null);
  }, [userId, grade, board, subscriptionPlan]);

  const dirty =
    gradeVal !== (grade || '') ||
    boardVal !== (board || '') ||
    planVal !== (subscriptionPlan || 'free');

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updates: Record<string, string> = {};
      if (gradeVal !== (grade || '') && gradeVal) updates.grade = gradeVal;
      if (boardVal !== (board || '') && boardVal) updates.board = boardVal;
      if (planVal !== (subscriptionPlan || 'free')) updates.subscription_plan = planVal;
      if (Object.keys(updates).length === 0) { setSaving(false); return; }

      const res = await apiFetch('/api/super-admin/users', {
        method: 'PATCH',
        body: JSON.stringify({ user_id: userId, table: 'students', updates }),
      });
      const d = await readAdminJson<{ error?: string; success?: boolean }>(res).catch(() => ({}) as { error?: string });
      if (!res.ok) {
        setError(d.error || (isHi ? 'सहेजना विफल' : 'Save failed'));
        return;
      }
      toast.success(isHi ? 'प्रोफ़ाइल अपडेट हो गई' : 'Profile updated');
      onSaved(updates);
    } catch {
      setError(isHi ? 'नेटवर्क त्रुटि — बदलाव सहेजा नहीं गया।' : 'Network error — the change was not saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-5">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {isHi ? 'प्रोफ़ाइल संपादित करें' : 'Edit Profile'}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="edit-profile-grade" className="mb-1 block text-[11px] text-muted-foreground">
            {isHi ? 'ग्रेड' : 'Grade'}
          </label>
          <select
            id="edit-profile-grade"
            value={gradeVal}
            onChange={(e) => setGradeVal(e.target.value)}
            disabled={saving}
            className="w-full cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">—</option>
            {withCurrentValue(GRADE_LIST, gradeVal).map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="edit-profile-board" className="mb-1 block text-[11px] text-muted-foreground">
            {isHi ? 'बोर्ड' : 'Board'}
          </label>
          <select
            id="edit-profile-board"
            value={boardVal}
            onChange={(e) => setBoardVal(e.target.value)}
            disabled={saving}
            className="w-full cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">—</option>
            {withCurrentValue(BOARD_LIST, boardVal).map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label htmlFor="edit-profile-plan" className="mb-1 block text-[11px] text-muted-foreground">
            {isHi ? 'प्लान' : 'Plan'}
          </label>
          <select
            id="edit-profile-plan"
            value={planVal}
            onChange={(e) => setPlanVal(e.target.value)}
            disabled={saving}
            className="w-full cursor-pointer rounded-md border border-surface-3 bg-surface-1 px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {withCurrentValue(PLAN_LIST, planVal).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <div role="alert" className="mt-2 text-xs font-medium text-danger">{error}</div>
      )}
      <button
        type="button"
        onClick={save}
        disabled={!dirty || saving}
        aria-busy={saving}
        className="mt-3 rounded-md bg-foreground px-4 py-2 text-xs font-semibold text-surface-1 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? (isHi ? 'सहेज रहे हैं…' : 'Saving…') : (isHi ? 'बदलाव सहेजें' : 'Save changes')}
      </button>
    </div>
  );
}
