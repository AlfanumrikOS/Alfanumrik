'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { SUBJECT_META } from '@/lib/constants';
import { VALID_GRADES } from '@/lib/identity';

// ============================================================
// BILINGUAL HELPERS (P7)
// ============================================================
const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

const GRADES = [...VALID_GRADES];
const SECTIONS = ['', 'A', 'B', 'C', 'D', 'E'];

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#FBF8F4',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  padding: '24px 16px 60px',
  fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#fff',
  borderRadius: 20,
  boxShadow: '0 8px 40px rgba(0,0,0,0.08)',
  padding: '36px 32px',
  width: '100%',
  maxWidth: 480,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  backgroundColor: '#F8F6F2',
  border: '1.5px solid #E8E0D5',
  borderRadius: 10,
  color: '#1A1A2E',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#6B7280',
  display: 'block',
  marginBottom: 5,
  fontWeight: 500,
};

const btnPrimary: React.CSSProperties = {
  width: '100%',
  padding: '14px 24px',
  background: 'linear-gradient(135deg, #F97316, #EA580C)',
  color: '#fff',
  border: 'none',
  borderRadius: 12,
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
  letterSpacing: 0.2,
};

// Progress dots
function Dots({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 32 }}>
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          style={{
            width: i < step ? 28 : 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: i < step ? '#F97316' : '#E8E0D5',
            transition: 'all 0.3s ease',
          }}
        />
      ))}
    </div>
  );
}

export default function TeacherOnboardingPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [classCode, setClassCode] = useState('');

  // Create class form
  const [formName, setFormName] = useState('');
  const [formGrade, setFormGrade] = useState('9');
  const [formSection, setFormSection] = useState('');
  const [formSubject, setFormSubject] = useState('math');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  // Auth guard
  useEffect(() => {
    if (authLoading) return;
    if (!isLoggedIn || (activeRole !== 'teacher' && !teacher)) {
      router.replace('/login');
      return;
    }
    // If already onboarded, redirect to dashboard
    const teacherRecord = teacher as (typeof teacher & { onboarding_completed?: boolean | null });
    if (teacherRecord?.onboarding_completed) {
      router.replace('/teacher');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  const handleCreateClass = async () => {
    const name = formName.trim();
    if (!name || name.length < 2) {
      setFormError(tt(isHi, 'Class name must be at least 2 characters', 'कक्षा का नाम कम से कम 2 अक्षरों का होना चाहिए'));
      return;
    }
    if (!/^[a-zA-Z0-9\s\-_().]+$/.test(name)) {
      setFormError(tt(isHi, 'Class name contains invalid characters', 'कक्षा के नाम में अमान्य अक्षर हैं'));
      return;
    }
    setCreating(true);
    setFormError('');
    try {
      const teacherId = teacher?.id;
      const { data, error } = await supabase.rpc('teacher_create_class', {
        p_teacher_id: teacherId,
        p_name: name,
        p_grade: formGrade,
        p_section: formSection || null,
        p_subject: formSubject,
      });
      if (error) throw error;
      // The RPC should return the class object or class_code
      const code = data?.class_code || data?.code || (typeof data === 'string' ? data : '');
      setClassCode(code);
      setStep(3);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : tt(isHi, 'Failed to create class', 'कक्षा बनाने में विफल'));
    } finally {
      setCreating(false);
    }
  };

  const handleFinish = async () => {
    try {
      if (teacher?.id) {
        // Mark onboarding complete — field exists in DB but not in local TS type
        await supabase
          .from('teachers')
          .update({ onboarding_completed: true } as Record<string, unknown>)
          .eq('id', teacher.id);
      }
    } catch {
      // Non-blocking — proceed to dashboard regardless
    }
    router.push('/teacher');
  };

  const copyCode = () => {
    if (classCode) {
      navigator.clipboard.writeText(classCode).catch(() => null);
    }
  };

  const whatsappShare = () => {
    const msg = encodeURIComponent(
      tt(isHi,
        `Join my class on Alfanumrik! Code: ${classCode}`,
        `Alfanumrik पर मेरी कक्षा में जुड़ें! कोड: ${classCode}`
      )
    );
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  };

  if (authLoading) {
    return (
      <div style={{ ...pageStyle, justifyContent: 'center' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #E8E0D5', borderTopColor: '#F97316', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const teacherName = teacher?.name || tt(isHi, 'Teacher', 'शिक्षक');
  const subjectMeta = SUBJECT_META.find(s => s.code === formSubject);

  return (
    <div style={pageStyle}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes bounceIn{0%{transform:scale(0.5);opacity:0}60%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}
      `}</style>

      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#F97316,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>A</div>
        <span style={{ fontSize: 20, fontWeight: 700, color: '#1A1A2E' }}>Alfanumrik</span>
      </div>

      <Dots step={step} total={4} />

      {/* Step 1 — Welcome */}
      {step === 1 && (
        <div style={{ ...cardStyle, animation: 'fadeIn 0.35s ease' }}>
          <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 16 }}>👋</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1A1A2E', margin: '0 0 8px', textAlign: 'center' }}>
            {tt(isHi, `Welcome, ${teacherName}!`, `स्वागत है, ${teacherName}!`)}
          </h1>
          <p style={{ fontSize: 15, color: '#6B7280', textAlign: 'center', margin: '0 0 28px', lineHeight: 1.6 }}>
            {tt(isHi,
              "Let's set up your classroom on Alfanumrik in just a few steps.",
              'आइए कुछ ही चरणों में Alfanumrik पर आपकी कक्षा सेट अप करें।'
            )}
          </p>

          {/* Profile summary */}
          <div style={{ backgroundColor: '#FBF8F4', borderRadius: 12, padding: '16px 18px', marginBottom: 28, border: '1px solid #E8E0D5' }}>
            <p style={{ fontSize: 13, color: '#9CA3AF', margin: '0 0 10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {tt(isHi, 'Your Profile', 'आपकी प्रोफ़ाइल')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: '#6B7280' }}>{tt(isHi, 'Name', 'नाम')}</span>
                <span style={{ color: '#1A1A2E', fontWeight: 600 }}>{teacherName}</span>
              </div>
            </div>
          </div>

          <button onClick={() => setStep(2)} style={btnPrimary}>
            {tt(isHi, "Let's get started →", 'शुरू करें →')}
          </button>
        </div>
      )}

      {/* Step 2 — Create First Class */}
      {step === 2 && (
        <div style={{ ...cardStyle, animation: 'fadeIn 0.35s ease' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A2E', margin: '0 0 6px' }}>
            {tt(isHi, 'Create your first class', 'अपनी पहली कक्षा बनाएं')}
          </h2>
          <p style={{ fontSize: 14, color: '#9CA3AF', margin: '0 0 24px' }}>
            {tt(isHi, 'Students will join using the class code generated below.', 'छात्र नीचे बनाए गए कक्षा कोड का उपयोग करके जुड़ेंगे।')}
          </p>

          {/* Class Name */}
          <label style={{ display: 'block', marginBottom: 14 }}>
            <span style={labelStyle}>{tt(isHi, 'Class Name', 'कक्षा का नाम')}</span>
            <input
              type="text"
              placeholder={tt(isHi, 'e.g. 10-A Science', 'जैसे 10-A विज्ञान')}
              value={formName}
              onChange={e => setFormName(e.target.value)}
              style={inputStyle}
            />
          </label>

          {/* Grade + Section */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <label>
              <span style={labelStyle}>{tt(isHi, 'Grade', 'कक्षा')}</span>
              <select value={formGrade} onChange={e => setFormGrade(e.target.value)} style={inputStyle}>
                {GRADES.map(g => (
                  <option key={g} value={g}>{tt(isHi, `Grade ${g}`, `कक्षा ${g}`)}</option>
                ))}
              </select>
            </label>
            <label>
              <span style={labelStyle}>{tt(isHi, 'Section', 'सेक्शन')}</span>
              <select value={formSection} onChange={e => setFormSection(e.target.value)} style={inputStyle}>
                {SECTIONS.map(s => (
                  <option key={s} value={s}>{s || tt(isHi, 'None', 'कोई नहीं')}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Subject */}
          <label style={{ display: 'block', marginBottom: 20 }}>
            <span style={labelStyle}>{tt(isHi, 'Subject', 'विषय')}</span>
            <select value={formSubject} onChange={e => setFormSubject(e.target.value)} style={inputStyle}>
              {SUBJECT_META.map(s => (
                <option key={s.code} value={s.code}>{s.icon} {s.name}</option>
              ))}
            </select>
          </label>

          {formError && (
            <div style={{ backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#DC2626', fontSize: 13 }}>
              {formError}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setStep(1)}
              style={{ flex: 1, padding: '12px', backgroundColor: 'transparent', color: '#9CA3AF', border: '1.5px solid #E8E0D5', borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
            >
              {tt(isHi, '← Back', '← वापस')}
            </button>
            <button
              onClick={handleCreateClass}
              disabled={creating || !formName.trim()}
              style={{
                flex: 2, padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: creating || !formName.trim() ? 'default' : 'pointer',
                background: creating || !formName.trim() ? '#E8E0D5' : 'linear-gradient(135deg, #F97316, #EA580C)',
                color: creating || !formName.trim() ? '#9CA3AF' : '#fff', border: 'none',
              }}
            >
              {creating
                ? tt(isHi, 'Creating...', 'बना रहे हैं...')
                : tt(isHi, `Create ${subjectMeta?.name || 'Class'} →`, `${subjectMeta?.name || 'कक्षा'} बनाएं →`)
              }
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Share class code */}
      {step === 3 && (
        <div style={{ ...cardStyle, animation: 'fadeIn 0.35s ease' }}>
          <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 12 }}>🎉</div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1A1A2E', margin: '0 0 6px', textAlign: 'center' }}>
            {tt(isHi, 'Class created!', 'कक्षा बनाई गई!')}
          </h2>
          <p style={{ fontSize: 14, color: '#9CA3AF', margin: '0 0 28px', textAlign: 'center' }}>
            {tt(isHi, 'Share this code with your students so they can join.', 'यह कोड अपने छात्रों के साथ साझा करें ताकि वे जुड़ सकें।')}
          </p>

          {/* Big code display */}
          <div style={{ backgroundColor: '#FBF8F4', border: '2px dashed #F97316', borderRadius: 16, padding: '28px 20px', textAlign: 'center', marginBottom: 24 }}>
            <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
              {tt(isHi, 'Class Code', 'कक्षा कोड')}
            </p>
            <div style={{ fontSize: 40, fontWeight: 800, color: '#F97316', fontFamily: 'monospace', letterSpacing: 6 }}>
              {classCode || '------'}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            <button
              onClick={copyCode}
              style={{ ...btnPrimary, background: 'linear-gradient(135deg,#1D4ED8,#2563EB)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              📋 {tt(isHi, 'Copy Code', 'कोड कॉपी करें')}
            </button>
            <button
              onClick={whatsappShare}
              style={{ ...btnPrimary, background: 'linear-gradient(135deg,#25D366,#128C7E)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              📲 {tt(isHi, 'Share on WhatsApp', 'WhatsApp पर साझा करें')}
            </button>
          </div>

          <p style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', margin: '0 0 20px', lineHeight: 1.6 }}>
            {tt(isHi,
              'Students open the Alfanumrik app, tap "Join Class" and enter this code.',
              'छात्र Alfanumrik ऐप खोलें, "कक्षा में शामिल हों" टैप करें और यह कोड दर्ज करें।'
            )}
          </p>

          <button onClick={() => setStep(4)} style={btnPrimary}>
            {tt(isHi, 'Continue →', 'जारी रखें →')}
          </button>
        </div>
      )}

      {/* Step 4 — Done */}
      {step === 4 && (
        <div style={{ ...cardStyle, textAlign: 'center', animation: 'fadeIn 0.35s ease' }}>
          <div style={{ fontSize: 72, marginBottom: 16, animation: 'bounceIn 0.6s ease' }}>✅</div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: '#1A1A2E', margin: '0 0 10px' }}>
            {tt(isHi, "You're all set!", 'आप तैयार हैं!')}
          </h2>
          <p style={{ fontSize: 16, color: '#059669', fontWeight: 600, margin: '0 0 8px' }}>
            {tt(isHi, 'Your class is ready!', 'आपकी कक्षा तैयार है!')}
          </p>
          <p style={{ fontSize: 14, color: '#9CA3AF', margin: '0 0 36px', lineHeight: 1.7, maxWidth: 340, marginLeft: 'auto', marginRight: 'auto' }}>
            {tt(isHi,
              'Head to your dashboard to track student progress, view mastery heatmaps, and create assignments.',
              'छात्रों की प्रगति ट्रैक करने, मास्टरी हीटमैप देखने और असाइनमेंट बनाने के लिए अपने डैशबोर्ड पर जाएं।'
            )}
          </p>
          <button onClick={handleFinish} style={btnPrimary}>
            {tt(isHi, 'Go to Dashboard →', 'डैशबोर्ड पर जाएं →')}
          </button>
        </div>
      )}
    </div>
  );
}
