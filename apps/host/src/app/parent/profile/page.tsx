'use client';

import { useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@alfanumrik/lib/supabase';
import { CardListSkeleton } from '@alfanumrik/ui/Skeleton';

// Parent-dashboard RCA Task 3.3 (2026-07-20): rebuilt on Tailwind utility
// classes + semantic design tokens (surface-1/2/3, foreground,
// muted-foreground, success/danger, brand orange) instead of hand-rolled
// inline style={{}} objects with raw hex literals. Business logic
// (validation rules, the guardians.update() write, sign-out flow) is
// unchanged -- this is a presentational-only refactor. The header
// previously used a green (#16A34A) gradient as a de-facto third brand
// color; it now uses the documented brand orange, matching every other
// parent-portal page (billing/messages/notifications/calendar).
export default function ParentProfilePage() {
  const { guardian, isLoggedIn, isLoading: authLoading, activeRole, signOut, isHi } = useAuth();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [toastIsError, setToastIsError] = useState(false);

  const tp = (en: string, hi: string) => isHi ? hi : en;

  if (authLoading) {
    return (
      <div className="min-h-[100dvh] bg-surface-2 px-5 pt-8">
        <div role="status" aria-busy="true">
          <span className="sr-only">{tp('Loading profile...', 'प्रोफ़ाइल लोड हो रही है...')}</span>
          <CardListSkeleton count={2} />
        </div>
      </div>
    );
  }
  if (!isLoggedIn || (activeRole !== 'guardian' && !guardian)) { router.replace('/login'); return null; }

  const startEdit = () => {
    setName(guardian?.name || '');
    setPhone(guardian?.phone || '');
    setEditing(true);
  };

  const showToast = (message: string, isError: boolean) => {
    setToast(message);
    setToastIsError(isError);
  };

  const handleSave = async () => {
    if (!guardian?.id) return;
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName || trimmedName.length < 2 || trimmedName.length > 100) {
      showToast(tp('Name must be 2-100 characters', 'नाम 2-100 अक्षरों का होना चाहिए'), true); return;
    }
    if (trimmedPhone && !/^[+]?\d{7,15}$/.test(trimmedPhone.replace(/[\s\-()]/g, ''))) {
      showToast(tp('Please enter a valid phone number', 'कृपया सही फ़ोन नंबर दर्ज करें'), true); return;
    }
    setSaving(true);
    try {
      await supabase.from('guardians').update({
        name: trimmedName,
        phone: trimmedPhone || null,
      }).eq('id', guardian.id);
      showToast(tp('Profile updated!', 'प्रोफ़ाइल अपडेट हो गई!'), false);
      setEditing(false);
      setTimeout(() => setToast(''), 3000);
    } catch { showToast(tp('Failed to save', 'सहेजने में विफल'), true); }
    setSaving(false);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  return (
    <div className="min-h-[100dvh] bg-surface-2 pb-24">
      {/* Header */}
      <div className="relative bg-gradient-to-br from-orange-500 to-orange-600 px-5 pb-7 pt-8 text-white">
        <button
          onClick={() => router.push('/parent')}
          className="absolute left-4 top-4 rounded-lg bg-white/20 px-3 py-1.5 text-[13px] font-semibold text-white"
        >
          &larr; {tp('Dashboard', 'डैशबोर्ड')}
        </button>
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-white/20 text-4xl">
            {guardian?.name?.[0]?.toUpperCase() || '👨‍👩‍👧'}
          </div>
          <h1 className="m-0 text-[22px] font-bold">{guardian?.name || (isHi ? 'अभिभावक' : 'Parent')}</h1>
          <p className="mt-1 text-[13px] opacity-80">{guardian?.email || 'Alfanumrik Parent'}</p>
        </div>
      </div>

      {toast && (
        <div
          role="alert"
          className={
            'mx-5 mt-4 rounded-[10px] px-4 py-2.5 text-center text-[13px] font-semibold ' +
            (toastIsError
              ? 'bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-danger'
              : 'bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-success')
          }
        >
          {toast}
        </div>
      )}

      <div className="p-5">
        {!editing ? (
          <div className="rounded-2xl border border-surface-3 bg-surface-1 p-5">
            <div className="mb-4 text-[15px] font-bold text-foreground">{tp('Profile Details', 'प्रोफ़ाइल विवरण')}</div>

            <div className="mb-3.5">
              <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{tp('Name', 'नाम')}</div>
              <div className="text-[15px] font-medium text-foreground">{guardian?.name || '—'}</div>
            </div>
            <div className="mb-3.5">
              <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{tp('Email', 'ईमेल')}</div>
              <div className="text-[15px] font-medium text-foreground">{guardian?.email || '—'}</div>
            </div>
            <div className="mb-3.5">
              <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">{tp('Phone', 'फ़ोन')}</div>
              <div className="text-[15px] font-medium text-foreground">{guardian?.phone || tp('Not set', 'सेट नहीं')}</div>
            </div>

            <button
              onClick={startEdit}
              className="mt-2 rounded-[10px] border-[1.5px] border-orange-500 bg-surface-1 px-6 py-2.5 text-[13px] font-semibold text-orange-600"
            >
              {tp('Edit Profile', 'प्रोफ़ाइल संपादित करें')}
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-surface-3 bg-surface-1 p-5">
            <div className="mb-4 text-[15px] font-bold text-foreground">{tp('Edit Profile', 'प्रोफ़ाइल संपादित करें')}</div>
            <div className="mb-3">
              <label htmlFor="parent-name" className="mb-1 block text-xs font-semibold text-muted-foreground">{tp('Name', 'नाम')}</label>
              <input
                id="parent-name"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full rounded-[10px] border-[1.5px] border-surface-3 bg-surface-1 px-3.5 py-2.5 text-base text-foreground outline-none"
              />
            </div>
            <div className="mb-4">
              <label htmlFor="parent-phone" className="mb-1 block text-xs font-semibold text-muted-foreground">{tp('Phone', 'फ़ोन')}</label>
              <input
                id="parent-phone"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+91 XXXXX XXXXX"
                className="w-full rounded-[10px] border-[1.5px] border-surface-3 bg-surface-1 px-3.5 py-2.5 text-base text-foreground outline-none"
              />
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-[10px] border-none bg-orange-500 px-6 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60"
              >
                {saving ? tp('Saving...', 'सहेज रहे हैं...') : tp('Save', 'सहेजें')}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="rounded-[10px] border-[1.5px] border-surface-3 bg-surface-1 px-6 py-2.5 text-[13px] font-semibold text-muted-foreground"
              >
                {tp('Cancel', 'रद्द करें')}
              </button>
            </div>
          </div>
        )}

        {/* Quick links */}
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            onClick={() => router.push('/parent/reports')}
            className="rounded-xl border border-surface-3 bg-surface-1 p-3.5 text-center"
          >
            <div className="mb-1 text-2xl">📊</div>
            <div className="text-xs font-semibold text-muted-foreground">{tp('Reports', 'रिपोर्ट')}</div>
          </button>
          <button
            onClick={() => router.push('/parent/support')}
            className="rounded-xl border border-surface-3 bg-surface-1 p-3.5 text-center"
          >
            <div className="mb-1 text-2xl">💬</div>
            <div className="text-xs font-semibold text-muted-foreground">{tp('Support', 'सहायता')}</div>
          </button>
        </div>

        <button
          onClick={handleSignOut}
          className="mt-5 w-full rounded-xl border-[1.5px] border-danger bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] py-3 text-sm font-semibold text-danger"
        >
          {tp('Sign Out', 'साइन आउट')}
        </button>
      </div>
    </div>
  );
}
