'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
const WIZARD_KEY = 'alfanumrik_school_wizard_complete';
const TOTAL_STEPS = 5;

/** P5: grades are strings "6" through "12" */
const GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;
const SECTIONS = ['A', 'B', 'C', 'D'] as const;

/* ─────────────────────────────────────────────────────────────
   BILINGUAL HELPER (P7)
───────────────────────────────────────────────────────────── */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* ─────────────────────────────────────────────────────────────
   API HELPER — attaches auth token
───────────────────────────────────────────────────────────── */
async function apiCall(
  url: string,
  method: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: any; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!res.ok || json.success === false) {
      return { success: false, error: json.error || `Request failed (${res.status})` };
    }
    return { success: true, data: json.data };
  } catch {
    return { success: false, error: 'Network error. Please try again.' };
  }
}

/* ─────────────────────────────────────────────────────────────
   STEP INDICATOR
───────────────────────────────────────────────────────────── */
interface StepIndicatorProps {
  currentStep: number;
  completedSteps: Set<number>;
  isHi: boolean;
}

const STEP_LABELS = {
  en: ['Welcome', 'Branding', 'Teachers', 'Classes', 'Invite Codes'],
  hi: ['स्वागत', 'ब्रांडिंग', 'शिक्षक', 'कक्षाएं', 'आमंत्रण कोड'],
};

function StepIndicator({ currentStep, completedSteps, isHi }: StepIndicatorProps) {
  const labels = isHi ? STEP_LABELS.hi : STEP_LABELS.en;

  return (
    <div className="w-full mb-8">
      {/* Progress bar */}
      <div className="flex gap-1.5 mb-3">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => {
          const step = i + 1;
          const isComplete = completedSteps.has(step);
          const isCurrent = step === currentStep;
          return (
            <div
              key={step}
              className="flex-1 h-1.5 rounded-full transition-all duration-300"
              style={{
                background: isComplete
                  ? '#7C3AED'
                  : isCurrent
                    ? '#F97316'
                    : '#E5E7EB',
              }}
            />
          );
        })}
      </div>

      {/* Step labels */}
      <div className="flex justify-between">
        {labels.map((label, i) => {
          const step = i + 1;
          const isComplete = completedSteps.has(step);
          const isCurrent = step === currentStep;
          return (
            <span
              key={step}
              className="text-[10px] font-medium transition-colors duration-200"
              style={{
                color: isComplete
                  ? '#7C3AED'
                  : isCurrent
                    ? '#F97316'
                    : '#9CA3AF',
              }}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STEP 1: WELCOME
───────────────────────────────────────────────────────────── */
interface WelcomeStepProps {
  schoolName: string;
  isHi: boolean;
  onNext: () => void;
}

function WelcomeStep({ schoolName, isHi, onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center text-center px-2">
      <div
        className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: '#7C3AED12' }}
      >
        <span className="text-4xl" aria-hidden="true">🏫</span>
      </div>

      <h2
        className="text-xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display, Sora, system-ui, sans-serif)', color: 'var(--text-1, #111)' }}
      >
        {schoolName}
      </h2>

      <p
        className="text-lg font-semibold mb-2"
        style={{ color: '#7C3AED' }}
      >
        {t(isHi,
          'Welcome to Alfanumrik!',
          'Alfanumrik में आपका स्वागत है!'
        )}
      </p>

      <p
        className="text-sm mb-8 max-w-xs"
        style={{ color: 'var(--text-3, #666)' }}
      >
        {t(isHi,
          "Let's set up your school in 5 easy steps. It only takes a few minutes.",
          'आइए 5 आसान चरणों में अपना स्कूल सेट करें। इसमें बस कुछ ही मिनट लगेंगे।'
        )}
      </p>

      <button
        onClick={onNext}
        className="w-full max-w-xs py-3 rounded-xl text-white font-semibold text-sm transition-all active:scale-[0.98]"
        style={{ background: '#F97316', minHeight: 48 }}
      >
        {t(isHi, 'Get Started', 'शुरू करें')}
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STEP 2: BRANDING
───────────────────────────────────────────────────────────── */
interface BrandingStepProps {
  isHi: boolean;
  onNext: () => void;
  onBack: () => void;
}

function BrandingStep({ isHi, onNext, onBack }: BrandingStepProps) {
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#7C3AED');
  const [secondaryColor, setSecondaryColor] = useState('#F97316');
  const [tagline, setTagline] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');

    const result = await apiCall('/api/school-admin/branding', 'PUT', {
      logo_url: logoUrl || null,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      tagline: tagline || null,
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error || t(isHi, 'Failed to save branding', 'ब्रांडिंग सहेजने में विफल'));
      return;
    }

    onNext();
  };

  return (
    <div className="space-y-5">
      <div className="text-center mb-2">
        <h2
          className="text-lg font-bold"
          style={{ fontFamily: 'var(--font-display, Sora, system-ui, sans-serif)', color: 'var(--text-1, #111)' }}
        >
          {t(isHi, 'School Branding', 'स्कूल ब्रांडिंग')}
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3, #666)' }}>
          {t(isHi,
            'Customize how your school appears on Alfanumrik',
            'Alfanumrik पर आपका स्कूल कैसा दिखे, यह अनुकूलित करें'
          )}
        </p>
      </div>

      {/* Logo URL */}
      <div>
        <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2, #333)' }}>
          {t(isHi, 'School Logo URL', 'स्कूल लोगो URL')}
        </label>
        <input
          type="url"
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          placeholder="https://example.com/logo.png"
          className="w-full px-3 py-2.5 rounded-xl text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
          style={{
            background: 'var(--surface-1, #fff)',
            border: '1px solid var(--border, #e5e7eb)',
            color: 'var(--text-1, #111)',
          }}
        />
        {/* Logo preview */}
        {logoUrl && (
          <div className="mt-2 flex items-center gap-2">
            <img
              src={logoUrl}
              alt={t(isHi, 'Logo preview', 'लोगो पूर्वावलोकन')}
              className="w-10 h-10 rounded-lg object-contain"
              style={{ border: '1px solid var(--border, #e5e7eb)' }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <span className="text-xs" style={{ color: 'var(--text-3, #666)' }}>
              {t(isHi, 'Preview', 'पूर्वावलोकन')}
            </span>
          </div>
        )}
      </div>

      {/* Color pickers */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2, #333)' }}>
            {t(isHi, 'Primary Color', 'मुख्य रंग')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
              style={{ minHeight: 44, minWidth: 44 }}
            />
            <span className="text-xs font-mono" style={{ color: 'var(--text-3, #666)' }}>
              {primaryColor}
            </span>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2, #333)' }}>
            {t(isHi, 'Secondary Color', 'गौण रंग')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={secondaryColor}
              onChange={(e) => setSecondaryColor(e.target.value)}
              className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
              style={{ minHeight: 44, minWidth: 44 }}
            />
            <span className="text-xs font-mono" style={{ color: 'var(--text-3, #666)' }}>
              {secondaryColor}
            </span>
          </div>
        </div>
      </div>

      {/* Tagline */}
      <div>
        <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2, #333)' }}>
          {t(isHi, 'School Tagline', 'स्कूल टैगलाइन')}
        </label>
        <input
          type="text"
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          maxLength={200}
          placeholder={t(isHi, 'e.g., "Empowering young minds"', 'जैसे, "युवा मन को सशक्त बनाना"')}
          className="w-full px-3 py-2.5 rounded-xl text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
          style={{
            background: 'var(--surface-1, #fff)',
            border: '1px solid var(--border, #e5e7eb)',
            color: 'var(--text-1, #111)',
          }}
        />
        <p className="text-[10px] mt-1 text-right" style={{ color: 'var(--text-4, #999)' }}>
          {tagline.length}/200
        </p>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 text-center">{error}</p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={{
            background: 'var(--surface-2, #f5f5f5)',
            border: '1px solid var(--border, #e5e7eb)',
            color: 'var(--text-2, #333)',
            minHeight: 44,
          }}
        >
          {t(isHi, 'Back', 'वापस')}
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60"
          style={{ background: '#F97316', minHeight: 44 }}
        >
          {saving
            ? t(isHi, 'Saving...', 'सहेजा जा रहा है...')
            : t(isHi, 'Save & Continue', 'सहेजें और आगे बढ़ें')
          }
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STEP 3: INVITE TEACHERS
───────────────────────────────────────────────────────────── */
interface InviteTeachersStepProps {
  isHi: boolean;
  onNext: () => void;
  onBack: () => void;
}

function InviteTeachersStep({ isHi, onNext, onBack }: InviteTeachersStepProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successCount, setSuccessCount] = useState(0);
  const [lastInvitedName, setLastInvitedName] = useState('');

  const handleInvite = async () => {
    if (!name.trim() || !email.trim()) {
      setError(t(isHi, 'Name and email are required', 'नाम और ईमेल आवश्यक हैं'));
      return;
    }

    setSaving(true);
    setError('');

    const result = await apiCall('/api/school-admin/teachers', 'POST', {
      name: name.trim(),
      email: email.trim(),
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error || t(isHi, 'Failed to invite teacher', 'शिक्षक को आमंत्रित करने में विफल'));
      return;
    }

    setLastInvitedName(name.trim());
    setSuccessCount((c) => c + 1);
    setName('');
    setEmail('');
  };

  return (
    <div className="space-y-5">
      <div className="text-center mb-2">
        <h2
          className="text-lg font-bold"
          style={{ fontFamily: 'var(--font-display, Sora, system-ui, sans-serif)', color: 'var(--text-1, #111)' }}
        >
          {t(isHi, 'Invite Teachers', 'शिक्षकों को आमंत्रित करें')}
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3, #666)' }}>
          {t(isHi,
            'Add your first teacher. You can add more later.',
            'अपने पहले शिक्षक को जोड़ें। आप बाद में और जोड़ सकते हैं।'
          )}
        </p>
      </div>

      {/* Success message */}
      {successCount > 0 && (
        <div
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm"
          style={{ background: '#ECFDF5', border: '1px solid #A7F3D0' }}
        >
          <span style={{ color: '#065F46' }}>
            {t(isHi,
              `${lastInvitedName} invited! They'll receive an email.`,
              `${lastInvitedName} को आमंत्रित किया गया! उन्हें एक ईमेल मिलेगा।`
            )}
          </span>
        </div>
      )}

      {/* Teacher name */}
      <div>
        <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2, #333)' }}>
          {t(isHi, 'Teacher Name', 'शिक्षक का नाम')}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(isHi, 'e.g., Priya Sharma', 'जैसे, प्रिया शर्मा')}
          className="w-full px-3 py-2.5 rounded-xl text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
          style={{
            background: 'var(--surface-1, #fff)',
            border: '1px solid var(--border, #e5e7eb)',
            color: 'var(--text-1, #111)',
          }}
        />
      </div>

      {/* Teacher email */}
      <div>
        <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2, #333)' }}>
          {t(isHi, 'Teacher Email', 'शिक्षक का ईमेल')}
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teacher@school.edu"
          className="w-full px-3 py-2.5 rounded-xl text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
          style={{
            background: 'var(--surface-1, #fff)',
            border: '1px solid var(--border, #e5e7eb)',
            color: 'var(--text-1, #111)',
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 text-center">{error}</p>
      )}

      {/* Invite button */}
      <button
        onClick={handleInvite}
        disabled={saving}
        className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60"
        style={{
          background: '#7C3AED',
          color: '#fff',
          minHeight: 44,
        }}
      >
        {saving
          ? t(isHi, 'Inviting...', 'आमंत्रित किया जा रहा है...')
          : t(isHi, 'Invite Teacher', 'शिक्षक को आमंत्रित करें')
        }
      </button>

      {/* Teacher count */}
      {successCount > 0 && (
        <p className="text-xs text-center" style={{ color: 'var(--text-3, #666)' }}>
          {t(isHi,
            `${successCount} teacher${successCount > 1 ? 's' : ''} invited so far`,
            `अब तक ${successCount} शिक्षक आमंत्रित`
          )}
        </p>
      )}

      {/* Navigation */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={{
            background: 'var(--surface-2, #f5f5f5)',
            border: '1px solid var(--border, #e5e7eb)',
            color: 'var(--text-2, #333)',
            minHeight: 44,
          }}
        >
          {t(isHi, 'Back', 'वापस')}
        </button>
        <button
          onClick={onNext}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={{
            background: successCount > 0 ? '#F97316' : 'var(--surface-2, #f5f5f5)',
            color: successCount > 0 ? '#fff' : 'var(--text-2, #333)',
            border: successCount > 0 ? 'none' : '1px solid var(--border, #e5e7eb)',
            minHeight: 44,
          }}
        >
          {successCount > 0
            ? t(isHi, 'Continue', 'आगे बढ़ें')
            : t(isHi, 'Skip', 'छोड़ें')
          }
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STEP 4: CREATE FIRST CLASS
───────────────────────────────────────────────────────────── */
interface CreateClassStepProps {
  isHi: boolean;
  onNext: () => void;
  onBack: () => void;
}

function CreateClassStep({ isHi, onNext, onBack }: CreateClassStepProps) {
  const [grade, setGrade] = useState<string>('6'); // P5: string
  const [section, setSection] = useState<string>('A');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdClassCode, setCreatedClassCode] = useState('');

  const handleCreate = async () => {
    setSaving(true);
    setError('');

    const className = `${t(isHi, 'Class', 'कक्षा')} ${grade}-${section}`;

    const result = await apiCall('/api/school-admin/classes', 'POST', {
      name: className,
      grade, // P5: string "6"-"12"
      section,
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error || t(isHi, 'Failed to create class', 'कक्षा बनाने में विफल'));
      return;
    }

    setCreatedClassCode(result.data?.class_code || '');
  };

  return (
    <div className="space-y-5">
      <div className="text-center mb-2">
        <h2
          className="text-lg font-bold"
          style={{ fontFamily: 'var(--font-display, Sora, system-ui, sans-serif)', color: 'var(--text-1, #111)' }}
        >
          {t(isHi, 'Create First Class', 'पहली कक्षा बनाएं')}
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3, #666)' }}>
          {t(isHi,
            'Set up your first class. You can add more later.',
            'अपनी पहली कक्षा बनाएं। आप बाद में और जोड़ सकते हैं।'
          )}
        </p>
      </div>

      {/* Class created success */}
      {createdClassCode && (
        <div
          className="flex flex-col items-center gap-2 px-4 py-4 rounded-xl text-center"
          style={{ background: '#ECFDF5', border: '1px solid #A7F3D0' }}
        >
          <p className="text-sm font-semibold" style={{ color: '#065F46' }}>
            {t(isHi, 'Class created!', 'कक्षा बन गई!')}
          </p>
          <p className="text-xs" style={{ color: '#065F46' }}>
            {t(isHi, 'Class code:', 'कक्षा कोड:')}
          </p>
          <span
            className="text-lg font-bold font-mono px-4 py-1.5 rounded-lg"
            style={{ background: '#fff', color: '#7C3AED', border: '1px solid #A7F3D0' }}
          >
            {createdClassCode}
          </span>
        </div>
      )}

      {/* Grade selector (P5: strings) */}
      {!createdClassCode && (
        <>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2, #333)' }}>
              {t(isHi, 'Grade', 'कक्षा')}
            </label>
            <div className="flex flex-wrap gap-2">
              {GRADES.map((g) => (
                <button
                  key={g}
                  onClick={() => setGrade(g)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
                  style={{
                    background: grade === g ? '#7C3AED' : 'var(--surface-2, #f5f5f5)',
                    color: grade === g ? '#fff' : 'var(--text-2, #333)',
                    border: grade === g ? '1px solid #7C3AED' : '1px solid var(--border, #e5e7eb)',
                    minHeight: 44,
                    minWidth: 44,
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* Section selector */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2, #333)' }}>
              {t(isHi, 'Section', 'अनुभाग')}
            </label>
            <div className="flex gap-2">
              {SECTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSection(s)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
                  style={{
                    background: section === s ? '#F97316' : 'var(--surface-2, #f5f5f5)',
                    color: section === s ? '#fff' : 'var(--text-2, #333)',
                    border: section === s ? '1px solid #F97316' : '1px solid var(--border, #e5e7eb)',
                    minHeight: 44,
                    minWidth: 44,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-600 text-center">{error}</p>
          )}

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={saving}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60"
            style={{
              background: '#7C3AED',
              color: '#fff',
              minHeight: 44,
            }}
          >
            {saving
              ? t(isHi, 'Creating...', 'बनाया जा रहा है...')
              : t(isHi, `Create Class ${grade}-${section}`, `कक्षा ${grade}-${section} बनाएं`)
            }
          </button>
        </>
      )}

      {/* Navigation */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={{
            background: 'var(--surface-2, #f5f5f5)',
            border: '1px solid var(--border, #e5e7eb)',
            color: 'var(--text-2, #333)',
            minHeight: 44,
          }}
        >
          {t(isHi, 'Back', 'वापस')}
        </button>
        <button
          onClick={onNext}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={{
            background: createdClassCode ? '#F97316' : 'var(--surface-2, #f5f5f5)',
            color: createdClassCode ? '#fff' : 'var(--text-2, #333)',
            border: createdClassCode ? 'none' : '1px solid var(--border, #e5e7eb)',
            minHeight: 44,
          }}
        >
          {createdClassCode
            ? t(isHi, 'Continue', 'आगे बढ़ें')
            : t(isHi, 'Skip', 'छोड़ें')
          }
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STEP 5: GENERATE INVITE CODES
───────────────────────────────────────────────────────────── */
interface InviteCodesStepProps {
  isHi: boolean;
  onComplete: () => void;
  onBack: () => void;
}

function InviteCodesStep({ isHi, onComplete, onBack }: InviteCodesStepProps) {
  const [maxUses, setMaxUses] = useState(100);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setSaving(true);
    setError('');

    const result = await apiCall('/api/school-admin/invite-codes', 'POST', {
      role: 'student',
      max_uses: maxUses,
      expires_in_days: 90,
    });

    setSaving(false);

    if (!result.success) {
      setError(result.error || t(isHi, 'Failed to generate code', 'कोड बनाने में विफल'));
      return;
    }

    setGeneratedCode(result.data?.code || '');
  };

  const handleCopy = async () => {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = generatedCode;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-5">
      <div className="text-center mb-2">
        <h2
          className="text-lg font-bold"
          style={{ fontFamily: 'var(--font-display, Sora, system-ui, sans-serif)', color: 'var(--text-1, #111)' }}
        >
          {t(isHi, 'Generate Invite Code', 'आमंत्रण कोड बनाएं')}
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3, #666)' }}>
          {t(isHi,
            'Generate a code for students to join your school',
            'छात्रों को अपने स्कूल में शामिल करने के लिए एक कोड बनाएं'
          )}
        </p>
      </div>

      {/* Generated code display */}
      {generatedCode ? (
        <div className="space-y-4">
          <div
            className="flex flex-col items-center gap-3 px-4 py-6 rounded-xl text-center"
            style={{ background: '#F5F3FF', border: '1px solid #DDD6FE' }}
          >
            <p className="text-xs font-semibold" style={{ color: '#5B21B6' }}>
              {t(isHi, 'Your student invite code:', 'आपका छात्र आमंत्रण कोड:')}
            </p>
            <span
              className="text-2xl font-bold font-mono tracking-wider px-5 py-2.5 rounded-xl"
              style={{ background: '#fff', color: '#7C3AED', border: '2px solid #7C3AED' }}
            >
              {generatedCode}
            </span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
              style={{
                background: copied ? '#ECFDF5' : '#fff',
                border: copied ? '1px solid #A7F3D0' : '1px solid #DDD6FE',
                color: copied ? '#065F46' : '#5B21B6',
                minHeight: 44,
              }}
            >
              {copied
                ? t(isHi, 'Copied!', 'कॉपी हो गया!')
                : t(isHi, 'Copy Code', 'कोड कॉपी करें')
              }
            </button>
          </div>

          {/* Instructions */}
          <div
            className="px-4 py-3 rounded-xl text-xs space-y-1.5"
            style={{ background: 'var(--surface-2, #f5f5f5)', border: '1px solid var(--border, #e5e7eb)' }}
          >
            <p className="font-semibold" style={{ color: 'var(--text-1, #111)' }}>
              {t(isHi, 'How to use this code:', 'इस कोड का उपयोग कैसे करें:')}
            </p>
            <p style={{ color: 'var(--text-3, #666)' }}>
              {t(isHi,
                'Share this code with students. They enter it during signup to join your school automatically.',
                'यह कोड छात्रों के साथ साझा करें। साइनअप के दौरान इसे दर्ज करने पर वे स्वचालित रूप से आपके स्कूल में शामिल हो जाएंगे।'
              )}
            </p>
            <p style={{ color: 'var(--text-4, #999)' }}>
              {t(isHi,
                `Valid for ${maxUses} students, expires in 90 days.`,
                `${maxUses} छात्रों के लिए मान्य, 90 दिनों में समाप्त।`
              )}
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Max uses input */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2, #333)' }}>
              {t(isHi, 'Maximum number of students', 'छात्रों की अधिकतम संख्या')}
            </label>
            <input
              type="number"
              value={maxUses}
              onChange={(e) => setMaxUses(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
              min={1}
              max={100}
              className="w-full px-3 py-2.5 rounded-xl text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
              style={{
                background: 'var(--surface-1, #fff)',
                border: '1px solid var(--border, #e5e7eb)',
                color: 'var(--text-1, #111)',
              }}
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-4, #999)' }}>
              {t(isHi,
                'How many students can use this code (1-100)',
                'कितने छात्र इस कोड का उपयोग कर सकते हैं (1-100)'
              )}
            </p>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-600 text-center">{error}</p>
          )}

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={saving}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-60"
            style={{
              background: '#7C3AED',
              color: '#fff',
              minHeight: 44,
            }}
          >
            {saving
              ? t(isHi, 'Generating...', 'बनाया जा रहा है...')
              : t(isHi, 'Generate Code', 'कोड बनाएं')
            }
          </button>
        </>
      )}

      {/* Navigation */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98]"
          style={{
            background: 'var(--surface-2, #f5f5f5)',
            border: '1px solid var(--border, #e5e7eb)',
            color: 'var(--text-2, #333)',
            minHeight: 44,
          }}
        >
          {t(isHi, 'Back', 'वापस')}
        </button>
        <button
          onClick={onComplete}
          className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-[0.98]"
          style={{
            background: generatedCode ? '#16A34A' : '#F97316',
            minHeight: 44,
          }}
        >
          {generatedCode
            ? t(isHi, 'Done — Go to Dashboard', 'पूर्ण — डैशबोर्ड पर जाएं')
            : t(isHi, 'Finish Setup', 'सेटअप पूरा करें')
          }
        </button>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   MAIN WIZARD COMPONENT
═════════════════════════════════════════════════════════════ */
interface OnboardingWizardProps {
  /** School name to display in the welcome step */
  schoolName: string;
}

export default function OnboardingWizard({ schoolName }: OnboardingWizardProps) {
  const router = useRouter();
  const { isHi } = useAuth();

  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [isVisible, setIsVisible] = useState(false);

  // Check wizard completion on mount
  useEffect(() => {
    try {
      const complete = localStorage.getItem(WIZARD_KEY);
      if (complete !== 'true') {
        setIsVisible(true);
      }
    } catch {
      // localStorage not available (SSR or privacy mode) — show wizard
      setIsVisible(true);
    }
  }, []);

  const markComplete = useCallback((step: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(step);
      return next;
    });
  }, []);

  const goToStep = useCallback((step: number) => {
    setCurrentStep(step);
  }, []);

  const handleNext = useCallback((fromStep: number) => {
    markComplete(fromStep);
    goToStep(fromStep + 1);
  }, [markComplete, goToStep]);

  const handleBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(1, prev - 1));
  }, []);

  const handleComplete = useCallback(() => {
    markComplete(5);
    try {
      localStorage.setItem(WIZARD_KEY, 'true');
    } catch {
      // localStorage write may fail in privacy mode — non-critical
    }
    setIsVisible(false);
    router.push('/school-admin');
  }, [markComplete, router]);

  // Not visible — render nothing
  if (!isVisible) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t(isHi, 'School setup wizard', 'स्कूल सेटअप विज़ार्ड')}
    >
      {/* Card */}
      <div
        className="w-full max-w-[600px] max-h-[90vh] overflow-y-auto rounded-2xl p-6 sm:p-8"
        style={{
          background: '#fff',
          boxShadow: '0 24px 48px rgba(0,0,0,0.12)',
        }}
      >
        {/* Step indicator */}
        <StepIndicator
          currentStep={currentStep}
          completedSteps={completedSteps}
          isHi={isHi}
        />

        {/* Step content */}
        {currentStep === 1 && (
          <WelcomeStep
            schoolName={schoolName}
            isHi={isHi}
            onNext={() => handleNext(1)}
          />
        )}

        {currentStep === 2 && (
          <BrandingStep
            isHi={isHi}
            onNext={() => handleNext(2)}
            onBack={handleBack}
          />
        )}

        {currentStep === 3 && (
          <InviteTeachersStep
            isHi={isHi}
            onNext={() => handleNext(3)}
            onBack={handleBack}
          />
        )}

        {currentStep === 4 && (
          <CreateClassStep
            isHi={isHi}
            onNext={() => handleNext(4)}
            onBack={handleBack}
          />
        )}

        {currentStep === 5 && (
          <InviteCodesStep
            isHi={isHi}
            onComplete={handleComplete}
            onBack={handleBack}
          />
        )}

        {/* Step counter */}
        <p className="text-[10px] text-center mt-6" style={{ color: 'var(--text-4, #999)' }}>
          {t(isHi,
            `Step ${currentStep} of ${TOTAL_STEPS}`,
            `चरण ${currentStep} / ${TOTAL_STEPS}`
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Utility: check if the onboarding wizard has been completed.
 * Use this in the school admin layout to decide whether to render the wizard.
 *
 * Example usage in layout or page:
 * ```
 * const [showWizard, setShowWizard] = useState(false);
 * useEffect(() => {
 *   setShowWizard(!isOnboardingComplete());
 * }, []);
 * ```
 */
export function isOnboardingComplete(): boolean {
  try {
    return localStorage.getItem(WIZARD_KEY) === 'true';
  } catch {
    return false;
  }
}
