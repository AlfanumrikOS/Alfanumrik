'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  Card,
  CardBody,
  Button,
  Field,
  Input,
  Alert,
  Avatar,
} from '@/components/ui/primitives';

export default function ParentProfilePage() {
  const { guardian, isLoggedIn, isLoading: authLoading, activeRole, signOut, isHi } = useAuth();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const tp = (en: string, hi: string) => (isHi ? hi : en);

  if (authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-2">
        <div className="text-5xl" aria-hidden="true">
          👨‍👩‍👧
        </div>
      </div>
    );
  }
  if (!isLoggedIn || (activeRole !== 'guardian' && !guardian)) {
    router.replace('/login');
    return null;
  }

  const startEdit = () => {
    setName(guardian?.name || '');
    setPhone(guardian?.phone || '');
    setEditing(true);
  };

  const handleSave = async () => {
    if (!guardian?.id) return;
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName || trimmedName.length < 2 || trimmedName.length > 100) {
      setToast(tp('Name must be 2–100 characters', 'नाम 2–100 अक्षरों का होना चाहिए'));
      return;
    }
    if (trimmedPhone && !/^[+]?\d{7,15}$/.test(trimmedPhone.replace(/[\s\-()]/g, ''))) {
      setToast(tp('Please enter a valid phone number', 'कृपया सही फ़ोन नंबर दर्ज करें'));
      return;
    }
    setSaving(true);
    try {
      await supabase
        .from('guardians')
        .update({
          name: trimmedName,
          phone: trimmedPhone || null,
        })
        .eq('id', guardian.id);
      setToast(tp('Profile updated!', 'प्रोफ़ाइल अपडेट हो गई!'));
      setEditing(false);
      setTimeout(() => setToast(''), 3000);
    } catch {
      setToast(tp('Failed to save', 'सहेजने में विफल'));
    }
    setSaving(false);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  const toastIsError =
    toast.includes('Failed') ||
    toast.includes('must be') ||
    toast.includes('valid') ||
    toast.includes('विफल') ||
    toast.includes('होना चाहिए') ||
    toast.includes('सही');

  return (
    <div className="min-h-dvh bg-surface-2 pb-24">
      {/* Branded header */}
      <div className="relative bg-surface-accent px-5 pb-7 pt-8 text-on-surface-accent">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/parent')}
          className="absolute left-4 top-4 text-on-surface-accent"
        >
          ← {tp('Dashboard', 'डैशबोर्ड')}
        </Button>
        <div className="flex flex-col items-center text-center">
          <Avatar
            size="xl"
            name={guardian?.name || 'Parent'}
            alt={guardian?.name || tp('Parent', 'अभिभावक')}
            className="mb-3"
          />
          <h1 className="text-2xl font-bold">
            {guardian?.name || tp('Parent', 'अभिभावक')}
          </h1>
          <p className="mt-1 text-sm opacity-90">{guardian?.email || 'Alfanumrik Parent'}</p>
        </div>
      </div>

      {toast && (
        <div className="px-5 pt-4">
          <Alert tone={toastIsError ? 'danger' : 'success'}>{toast}</Alert>
        </div>
      )}

      <div className="space-y-5 p-5">
        {!editing ? (
          <Card>
            <CardBody>
              <h2 className="mb-4 text-base font-bold text-foreground">
                {tp('Profile Details', 'प्रोफ़ाइल विवरण')}
              </h2>

              <dl className="space-y-4">
                <div>
                  <dt className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    {tp('Name', 'नाम')}
                  </dt>
                  <dd className="text-base text-foreground">{guardian?.name || '—'}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    {tp('Email', 'ईमेल')}
                  </dt>
                  <dd className="text-base text-foreground">{guardian?.email || '—'}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    {tp('Phone', 'फ़ोन')}
                  </dt>
                  <dd className="text-base text-foreground">
                    {guardian?.phone || tp('Not set', 'सेट नहीं')}
                  </dd>
                </div>
              </dl>

              <Button variant="secondary" onClick={startEdit} className="mt-5">
                {tp('Edit Profile', 'प्रोफ़ाइल संपादित करें')}
              </Button>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody>
              <h2 className="mb-4 text-base font-bold text-foreground">
                {tp('Edit Profile', 'प्रोफ़ाइल संपादित करें')}
              </h2>
              <div className="space-y-4">
                <Field label={tp('Name', 'नाम')} htmlFor="parent-name">
                  <Input id="parent-name" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label={tp('Phone', 'फ़ोन')} htmlFor="parent-phone">
                  <Input
                    id="parent-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 XXXXX XXXXX"
                  />
                </Field>
                <div className="flex gap-3">
                  <Button onClick={handleSave} loading={saving} disabled={saving}>
                    {saving ? tp('Saving...', 'सहेज रहे हैं...') : tp('Save', 'सहेजें')}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    {tp('Cancel', 'रद्द करें')}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Quick links */}
        <div className="grid grid-cols-2 gap-3">
          <Card variant="interactive" onClick={() => router.push('/parent/reports')}>
            <CardBody className="text-center">
              <div className="mb-1 text-2xl" aria-hidden="true">
                📊
              </div>
              <div className="text-sm font-semibold text-foreground">{tp('Reports', 'रिपोर्ट')}</div>
            </CardBody>
          </Card>
          <Card variant="interactive" onClick={() => router.push('/parent/support')}>
            <CardBody className="text-center">
              <div className="mb-1 text-2xl" aria-hidden="true">
                💬
              </div>
              <div className="text-sm font-semibold text-foreground">{tp('Support', 'सहायता')}</div>
            </CardBody>
          </Card>
        </div>

        <Button variant="danger" onClick={handleSignOut} className="w-full">
          {tp('Sign Out', 'साइन आउट')}
        </Button>
      </div>
    </div>
  );
}
