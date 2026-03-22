'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function ParentProfilePage() {
  const { guardian, isLoggedIn, isLoading: authLoading, activeRole, signOut } = useAuth();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  if (authLoading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}><div style={{ fontSize: 48 }}>👨‍👩‍👧</div></div>;
  if (!isLoggedIn || (activeRole !== 'guardian' && !guardian)) { router.replace('/'); return null; }

  const startEdit = () => {
    setName(guardian?.name || '');
    setPhone(guardian?.phone || '');
    setEditing(true);
  };

  const handleSave = async () => {
    if (!guardian?.id) return;
    setSaving(true);
    try {
      await supabase.from('guardians').update({
        name: name.trim(),
        phone: phone.trim() || null,
      }).eq('id', guardian.id);
      setToast('Profile updated!');
      setEditing(false);
      setTimeout(() => setToast(''), 3000);
    } catch { setToast('Failed to save'); }
    setSaving(false);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', paddingBottom: 100 }}>
      <div style={{ background: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)', padding: '32px 20px 28px', color: '#fff', textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 12px' }}>
          {guardian?.name?.[0]?.toUpperCase() || '👨‍👩‍👧'}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{guardian?.name || 'Parent'}</h1>
        <p style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>{guardian?.email || 'Alfanumrik Parent'}</p>
      </div>

      {toast && (
        <div style={{ margin: '16px 20px 0', padding: '10px 16px', borderRadius: 10, background: '#D1FAE5', color: '#059669', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
          {toast}
        </div>
      )}

      <div style={{ padding: '20px' }}>
        {!editing ? (
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>Profile Details</div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Name</div>
              <div style={{ fontSize: 15, color: '#1a1a1a', fontWeight: 500 }}>{guardian?.name || '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Email</div>
              <div style={{ fontSize: 15, color: '#1a1a1a', fontWeight: 500 }}>{guardian?.email || '—'}</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Phone</div>
              <div style={{ fontSize: 15, color: '#1a1a1a', fontWeight: 500 }}>{guardian?.phone || 'Not set'}</div>
            </div>

            <button onClick={startEdit} style={{ marginTop: 8, padding: '10px 24px', borderRadius: 10, border: '1.5px solid #16A34A', background: '#fff', color: '#16A34A', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Edit Profile
            </button>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' }}>Edit Profile</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Name</label>
              <input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e0e0e0', fontSize: 14, outline: 'none' }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 4 }}>Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 XXXXX XXXXX" style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e0e0e0', fontSize: 14, outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleSave} disabled={saving} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: '#16A34A', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} style={{ padding: '10px 24px', borderRadius: 10, border: '1.5px solid #e0e0e0', background: '#fff', color: '#555', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Quick links */}
        <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={() => router.push('/parent/reports')} style={{ padding: '14px', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📊</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Reports</div>
          </button>
          <button onClick={() => router.push('/parent/support')} style={{ padding: '14px', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>💬</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Support</div>
          </button>
        </div>

        <button onClick={handleSignOut} style={{ marginTop: 20, width: '100%', padding: '12px', borderRadius: 12, border: '1.5px solid #EF4444', background: '#FEF2F2', color: '#EF4444', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}
