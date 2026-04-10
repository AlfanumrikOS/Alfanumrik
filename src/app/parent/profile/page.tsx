'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { BottomNav } from '@/components/ui';

export default function ParentProfilePage() {
  const { guardian, isLoggedIn, isLoading: authLoading, activeRole, signOut, isHi } = useAuth();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  if (authLoading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}><div style={{ fontSize: 48 }}>👨‍👩‍👧</div></div>;
  if (!isLoggedIn || (activeRole !== 'guardian' && !guardian)) { router.replace('/login'); return null; }

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
      setToast(tp('Name must be 2–100 characters', 'नाम 2–100 अक्षरों का होना चाहिए')); return;
    }
    if (trimmedPhone && !/^[+]?\d{7,15}$/.test(trimmedPhone.replace(/[\s\-()]/g, ''))) {
      setToast(tp('Please enter a valid phone number', 'कृपया सही फ़ोन नंबर दर्ज करें')); return;
    }
    setSaving(true);
    try {
      await supabase.from('guardians').update({
        name: trimmedName,
        phone: trimmedPhone || null,
      }).eq('id', guardian.id);
      setToast(tp('Profile updated!', 'प्रोफ़ाइल अपडेट हो गई!'));
      setEditing(false);
      setTimeout(() => setToast(''), 3000);
    } catch { setToast(tp('Failed to save', 'सहेजने में विफल')); }
    setSaving(false);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  const tp = (en: string, hi: string) => isHi ? hi : en;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', paddingBottom: 100 }}>
      <div style={{ background: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)', padding: '32px 20px 28px', color: '#fff', position: 'relative' }}>
        <button
          onClick={() => router.push('/parent')}
          style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          &larr; {tp('Dashboard', 'डैशबोर्ड')}
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 12px' }}>
            {guardian?.name?.[0]?.toUpperCase() || '👨‍👩‍👧'}
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{guardian?.name || (isHi ? 'अभिभावक' : 'Parent')}</h1>
          <p style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>{guardian?.email || 'Alfanumrik Parent'}</p>
        </div>
      </div>

      {toast && (
        <div role="alert" style={{ margin: '16px 20px 0', padding: '10px 16px', borderRadius: 10, background: toast.includes('Failed') || toast.includes('must be') || toast.includes('valid') ? '#FEE2E2' : '#D1FAE5', color: toast.includes('Failed') || toast.includes('must be') || toast.includes('valid') ? '#DC2626' : '#059669', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
          {toast}
        </div>
      )}

      <div style={{ padding: '20px' }}>
        {!editing ? (
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>{tp('Profile Details', 'प्रोफ़ाइल विवरण')}</div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{tp('Name', 'नाम')}</div>
              <div style={{ fontSize: 15, color: '#1a1a1a', fontWeight: 500 }}>{guardian?.name || '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{tp('Email', 'ईमेल')}</div>
              <div style={{ fontSize: 15, color: '#1a1a1a', fontWeight: 500 }}>{guardian?.email || '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{tp('Phone', 'फ़ोन')}</div>
              <div style={{ fontSize: 15, color: '#1a1a1a', fontWeight: 500 }}>{guardian?.phone || tp('Not set', 'सेट नहीं')}</div>
            </div>

            <button onClick={startEdit} style={{ marginTop: 8, padding: '10px 24px', borderRadius: 10, border: '1.5px solid #16A34A', background: '#fff', color: '#16A34A', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {tp('Edit Profile', 'प्रोफ़ाइल संपादित करें')}
            </button>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>{tp('Edit Profile', 'प्रोफ़ाइल संपादित करें')}</div>
            <div style={{ marginBottom: 12 }}>
              <label htmlFor="parent-name" style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>{tp('Name', 'नाम')}</label>
              <input id="parent-name" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e0e0e0', fontSize: 14, outline: 'none' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="parent-phone" style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>{tp('Phone', 'फ़ोन')}</label>
              <input id="parent-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 XXXXX XXXXX" style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e0e0e0', fontSize: 14, outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#16A34A', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {saving ? tp('Saving...', 'सहेज रहे हैं...') : tp('Save', 'सहेजें')}
              </button>
              <button onClick={() => setEditing(false)} style={{ padding: '10px 24px', borderRadius: 10, border: '1.5px solid #e0e0e0', background: '#fff', color: '#555', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {tp('Cancel', 'रद्द करें')}
              </button>
            </div>
          </div>
        )}

        {/* Quick links */}
        <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={() => router.push('/parent/reports')} style={{ padding: '14px', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📊</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>{tp('Reports', 'रिपोर्ट')}</div>
          </button>
          <button onClick={() => router.push('/parent/support')} style={{ padding: '14px', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>💬</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>{tp('Support', 'सहायता')}</div>
          </button>
        </div>

        <button onClick={handleSignOut} style={{ marginTop: 20, width: '100%', padding: '12px', borderRadius: 12, border: '1.5px solid #EF4444', background: '#FEF2F2', color: '#EF4444', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          {tp('Sign Out', 'साइन आउट')}
        </button>
      </div>
      <BottomNav />
    </div>
  );
}
