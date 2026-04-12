'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  Input,
  Select,
  Badge,
  StepIndicator,
  Skeleton,
  EmptyState,
  BottomNav,
} from '@/components/ui';

/* ─────────────────────────────────────────────────────────────
   BILINGUAL HELPER (P7)
───────────────────────────────────────────────────────────── */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
interface SchoolProfile {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
}

interface NewClass {
  name: string;
  grade: string;
  section: string;
}

interface CreatedClass {
  id: string;
  name: string;
  grade: string;
  section: string | null;
}

interface InviteCode {
  id: string;
  code: string;
  role: string;
  class_id: string | null;
  max_uses: number;
  expires_at: string;
}

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const GRADE_OPTIONS = [
  { value: '', label: 'Select grade / कक्षा चुनें' },
  ...VALID_GRADES.map((g) => ({ value: g, label: `Grade ${g}` })),
];

/* ─────────────────────────────────────────────────────────────
   STEP 1: SCHOOL PROFILE
───────────────────────────────────────────────────────────── */
interface Step1Props {
  profile: SchoolProfile;
  isHi: boolean;
  onSave: (updates: Partial<SchoolProfile>) => Promise<boolean>;
  saving: boolean;
}

function Step1Profile({ profile, isHi, onSave, saving }: Step1Props) {
  const [name, setName] = useState(profile.name);
  const [tagline, setTagline] = useState(profile.tagline ?? '');
  const [logoUrl, setLogoUrl] = useState(profile.logo_url ?? '');
  const [primaryColor, setPrimaryColor] = useState(profile.primary_color);
  const [secondaryColor, setSecondaryColor] = useState(profile.secondary_color);

  async function handleSave() {
    await onSave({
      name: name.trim(),
      tagline: tagline.trim() || null,
      logo_url: logoUrl.trim() || null,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
    });
  }

  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <span className="text-4xl" aria-hidden="true">🏫</span>
        <h2
          className="text-lg font-bold mt-2"
          style={{ fontFamily: 'Sora, system-ui, sans-serif', color: 'var(--text-1)' }}
        >
          {t(isHi, 'School Profile', 'स्कूल प्रोफ़ाइल')}
        </h2>
        <p className="text-sm text-[var(--text-3)] mt-1">
          {t(
            isHi,
            'Set up your school branding and identity',
            'अपने स्कूल की ब्रांडिंग और पहचान सेट करें'
          )}
        </p>
      </div>

      <Input
        label={t(isHi, 'School Name / स्कूल का नाम', 'School Name / स्कूल का नाम')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Delhi Public School, Noida"
      />

      <Input
        label={t(isHi, 'Tagline / टैगलाइन', 'Tagline / टैगलाइन')}
        value={tagline}
        onChange={(e) => setTagline(e.target.value)}
        placeholder="Excellence in Education"
      />

      <Input
        label={t(isHi, 'Logo URL / लोगो URL', 'Logo URL / लोगो URL')}
        value={logoUrl}
        onChange={(e) => setLogoUrl(e.target.value)}
        placeholder="https://example.com/logo.png"
        type="url"
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium">
            {t(isHi, 'Primary Color / प्राथमिक रंग', 'Primary Color / प्राथमिक रंग')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              className="w-10 h-10 rounded-lg border border-[var(--border)] cursor-pointer"
              style={{ padding: 2 }}
            />
            <span className="text-xs font-mono text-[var(--text-3)]">{primaryColor}</span>
          </div>
        </div>
        <div>
          <label className="text-xs text-[var(--text-3)] mb-1.5 block ml-1 font-medium">
            {t(isHi, 'Secondary Color / द्वितीय रंग', 'Secondary Color / द्वितीय रंग')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={secondaryColor}
              onChange={(e) => setSecondaryColor(e.target.value)}
              className="w-10 h-10 rounded-lg border border-[var(--border)] cursor-pointer"
              style={{ padding: 2 }}
            />
            <span className="text-xs font-mono text-[var(--text-3)]">{secondaryColor}</span>
          </div>
        </div>
      </div>

      {/* Color preview */}
      <div
        className="rounded-xl p-4 text-center"
        style={{
          background: primaryColor,
          color: '#fff',
          border: `2px solid ${secondaryColor}`,
        }}
      >
        <p className="text-sm font-semibold">{name || 'School Name'}</p>
        <p className="text-xs opacity-80 mt-1">{tagline || 'Your tagline here'}</p>
      </div>

      <Button
        variant="primary"
        fullWidth
        size="lg"
        onClick={handleSave}
        disabled={saving || !name.trim()}
      >
        {saving
          ? t(isHi, 'Saving...', 'सहेज रहे हैं...')
          : t(isHi, 'Save & Continue', 'सहेजें और आगे बढ़ें')}
      </Button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STEP 2: CREATE CLASSES
───────────────────────────────────────────────────────────── */
interface Step2Props {
  createdClasses: CreatedClass[];
  schoolId: string;
  isHi: boolean;
  onClassesCreated: (classes: CreatedClass[]) => void;
  onNext: () => void;
}

function Step2Classes({ createdClasses, schoolId, isHi, onClassesCreated, onNext }: Step2Props) {
  const [classList, setClassList] = useState<NewClass[]>([
    { name: '', grade: '', section: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addRow() {
    setClassList((prev) => [...prev, { name: '', grade: '', section: '' }]);
  }

  function removeRow(idx: number) {
    setClassList((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, field: keyof NewClass, value: string) {
    setClassList((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  }

  async function handleSave() {
    setError(null);

    // Validate
    const validClasses = classList.filter((c) => c.name.trim() && c.grade);
    if (validClasses.length === 0) {
      setError(t(isHi, 'Add at least one class with name and grade', 'कम से कम एक कक्षा नाम और ग्रेड के साथ जोड़ें'));
      return;
    }

    setSaving(true);

    try {
      const res = await fetch('/api/schools/setup/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school_id: schoolId,
          classes: validClasses.map((c) => ({
            name: c.name.trim(),
            grade: String(c.grade),
            section: c.section.trim() || undefined,
          })),
        }),
      });

      const result = await res.json();

      if (!result.success) {
        setError(result.error || 'Failed to create classes');
        setSaving(false);
        return;
      }

      onClassesCreated([...createdClasses, ...(result.data as CreatedClass[])]);
      setClassList([{ name: '', grade: '', section: '' }]);
    } catch {
      setError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <span className="text-4xl" aria-hidden="true">📚</span>
        <h2
          className="text-lg font-bold mt-2"
          style={{ fontFamily: 'Sora, system-ui, sans-serif', color: 'var(--text-1)' }}
        >
          {t(isHi, 'Create Classes', 'कक्षाएं बनाएं')}
        </h2>
        <p className="text-sm text-[var(--text-3)] mt-1">
          {t(
            isHi,
            'Add your classes and sections',
            'अपनी कक्षाएं और अनुभाग जोड़ें'
          )}
        </p>
      </div>

      {/* Already created classes */}
      {createdClasses.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
            {t(isHi, 'Created Classes', 'बनाई गई कक्षाएं')}
          </p>
          <div className="flex flex-wrap gap-2">
            {createdClasses.map((cls) => (
              <Badge key={cls.id} color="#16A34A" size="md">
                {cls.name} (Grade {cls.grade})
                {cls.section ? ` - ${cls.section}` : ''}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* New class rows */}
      {classList.map((cls, idx) => (
        <Card key={idx}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text-3)]">
                {t(isHi, `Class ${idx + 1}`, `कक्षा ${idx + 1}`)}
              </span>
              {classList.length > 1 && (
                <button
                  onClick={() => removeRow(idx)}
                  className="text-xs text-red-500 font-semibold"
                  aria-label={t(isHi, 'Remove this class', 'इस कक्षा को हटाएं')}
                >
                  {t(isHi, 'Remove', 'हटाएं')}
                </button>
              )}
            </div>

            <Input
              label={t(isHi, 'Name (e.g., 9-A)', 'नाम (जैसे, 9-A)')}
              value={cls.name}
              onChange={(e) => updateRow(idx, 'name', e.target.value)}
              placeholder="9-A"
            />

            <div className="grid grid-cols-2 gap-3">
              <Select
                label={t(isHi, 'Grade / कक्षा', 'Grade / कक्षा')}
                value={cls.grade}
                onChange={(v) => updateRow(idx, 'grade', v)}
                options={GRADE_OPTIONS}
              />
              <Input
                label={t(isHi, 'Section / अनुभाग', 'Section / अनुभाग')}
                value={cls.section}
                onChange={(e) => updateRow(idx, 'section', e.target.value)}
                placeholder="A"
              />
            </div>
          </div>
        </Card>
      ))}

      {error && (
        <p className="text-sm text-red-500 text-center font-medium" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button
          variant="ghost"
          onClick={addRow}
          className="flex-1"
        >
          {t(isHi, '+ Add Another', '+ एक और जोड़ें')}
        </Button>

        <Button
          variant="primary"
          onClick={handleSave}
          disabled={saving}
          className="flex-1"
        >
          {saving
            ? t(isHi, 'Saving...', 'सहेज रहे हैं...')
            : t(isHi, 'Save Classes', 'कक्षाएं सहेजें')}
        </Button>
      </div>

      {createdClasses.length > 0 && (
        <Button
          variant="primary"
          fullWidth
          size="lg"
          onClick={onNext}
        >
          {t(isHi, 'Continue to Invite Codes', 'आमंत्रण कोड पर आगे बढ़ें')} →
        </Button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STEP 3: INVITE TEACHERS
───────────────────────────────────────────────────────────── */
interface Step3Props {
  schoolId: string;
  schoolSlug: string;
  classes: CreatedClass[];
  inviteCodes: InviteCode[];
  isHi: boolean;
  onCodesGenerated: (codes: InviteCode[]) => void;
  onNext: () => void;
}

function Step3InviteCodes({
  schoolId,
  schoolSlug,
  classes,
  inviteCodes,
  isHi,
  onCodesGenerated,
  onNext,
}: Step3Props) {
  const [role, setRole] = useState<'teacher' | 'student'>('teacher');
  const [classId, setClassId] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const classOptions = [
    { value: '', label: t(isHi, 'School-wide', 'पूरे स्कूल के लिए') },
    ...classes.map((c) => ({
      value: c.id,
      label: `${c.name} (Grade ${c.grade})`,
    })),
  ];

  async function handleGenerate() {
    setError(null);
    setGenerating(true);

    try {
      const res = await fetch('/api/schools/setup/invite-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school_id: schoolId,
          role,
          class_id: classId || undefined,
          max_uses: role === 'teacher' ? 5 : 50,
          expires_days: 90,
        }),
      });

      const result = await res.json();

      if (!result.success) {
        setError(result.error || 'Failed to generate code');
        setGenerating(false);
        return;
      }

      onCodesGenerated([...inviteCodes, ...(result.data as InviteCode[])]);
    } catch {
      setError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'));
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy(code: string) {
    try {
      const joinUrl = `${schoolSlug}.alfanumrik.com/join?code=${code}`;
      await navigator.clipboard.writeText(joinUrl);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // Fallback: just copy the code
      try {
        await navigator.clipboard.writeText(code);
        setCopiedCode(code);
        setTimeout(() => setCopiedCode(null), 2000);
      } catch {
        // Silently ignore clipboard permission errors
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <span className="text-4xl" aria-hidden="true">🔑</span>
        <h2
          className="text-lg font-bold mt-2"
          style={{ fontFamily: 'Sora, system-ui, sans-serif', color: 'var(--text-1)' }}
        >
          {t(isHi, 'Invite Teachers & Students', 'शिक्षकों और छात्रों को आमंत्रित करें')}
        </h2>
        <p className="text-sm text-[var(--text-3)] mt-1">
          {t(
            isHi,
            'Generate invite codes and share with your team',
            'आमंत्रण कोड बनाएं और अपनी टीम के साथ साझा करें'
          )}
        </p>
      </div>

      {/* Generate form */}
      <Card accent="#7C3AED">
        <div className="space-y-3">
          <Select
            label={t(isHi, 'Role / भूमिका', 'Role / भूमिका')}
            value={role}
            onChange={(v) => setRole(v as 'teacher' | 'student')}
            options={[
              { value: 'teacher', label: t(isHi, 'Teacher', 'शिक्षक') },
              { value: 'student', label: t(isHi, 'Student', 'छात्र') },
            ]}
          />

          {role === 'student' && (
            <Select
              label={t(isHi, 'Class / कक्षा', 'Class / कक्षा')}
              value={classId}
              onChange={setClassId}
              options={classOptions}
            />
          )}

          {error && (
            <p className="text-sm text-red-500 font-medium" role="alert">{error}</p>
          )}

          <Button
            variant="primary"
            fullWidth
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating
              ? t(isHi, 'Generating...', 'बना रहे हैं...')
              : t(isHi, 'Generate Code', 'कोड बनाएं')}
          </Button>
        </div>
      </Card>

      {/* Generated codes list */}
      {inviteCodes.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider">
            {t(isHi, 'Generated Codes', 'बनाए गए कोड')} ({inviteCodes.length})
          </p>

          {inviteCodes.map((ic) => {
            const isCopied = copiedCode === ic.code;
            const className = ic.class_id
              ? classes.find((c) => c.id === ic.class_id)
              : null;

            return (
              <Card key={ic.id}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-2xl font-bold tracking-widest"
                      style={{
                        fontFamily: 'monospace',
                        color: 'var(--text-1)',
                        letterSpacing: '0.2em',
                      }}
                    >
                      {ic.code}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge color={ic.role === 'teacher' ? '#7C3AED' : '#F97316'}>
                        {ic.role === 'teacher'
                          ? t(isHi, 'Teacher', 'शिक्षक')
                          : t(isHi, 'Student', 'छात्र')}
                      </Badge>
                      {className && (
                        <span className="text-xs text-[var(--text-3)]">
                          {className.name}
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => handleCopy(ic.code)}
                    className="px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                    style={{
                      background: isCopied ? '#16A34A' : 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      color: isCopied ? '#fff' : 'var(--text-2)',
                      minHeight: '40px',
                    }}
                    aria-label={t(isHi, 'Copy join link', 'जॉइन लिंक कॉपी करें')}
                  >
                    {isCopied
                      ? t(isHi, 'Copied!', 'कॉपी हो गया!')
                      : t(isHi, 'Copy Link', 'लिंक कॉपी')}
                  </button>
                </div>

                <p className="text-xs text-[var(--text-3)] mt-2">
                  {t(isHi, 'Share link:', 'लिंक साझा करें:')}{' '}
                  <span className="font-mono text-[var(--text-2)]">
                    {schoolSlug}.alfanumrik.com/join?code={ic.code}
                  </span>
                </p>
              </Card>
            );
          })}
        </div>
      )}

      <Button
        variant="primary"
        fullWidth
        size="lg"
        onClick={onNext}
      >
        {t(isHi, 'Review & Launch', 'समीक्षा करें और लॉन्च करें')} →
      </Button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   STEP 4: REVIEW & LAUNCH
───────────────────────────────────────────────────────────── */
interface Step4Props {
  profile: SchoolProfile;
  classes: CreatedClass[];
  inviteCodes: InviteCode[];
  isHi: boolean;
  onLaunch: () => Promise<void>;
  launching: boolean;
}

function Step4Review({ profile, classes, inviteCodes, isHi, onLaunch, launching }: Step4Props) {
  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <span className="text-4xl" aria-hidden="true">🚀</span>
        <h2
          className="text-lg font-bold mt-2"
          style={{ fontFamily: 'Sora, system-ui, sans-serif', color: 'var(--text-1)' }}
        >
          {t(isHi, 'Review & Launch', 'समीक्षा और लॉन्च')}
        </h2>
        <p className="text-sm text-[var(--text-3)] mt-1">
          {t(
            isHi,
            'Everything looks good? Launch your school!',
            'सब कुछ ठीक है? अपना स्कूल लॉन्च करें!'
          )}
        </p>
      </div>

      {/* School Profile Summary */}
      <Card accent={profile.primary_color}>
        <h3 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wider mb-3">
          {t(isHi, 'School Profile', 'स्कूल प्रोफ़ाइल')}
        </h3>
        <div
          className="rounded-xl p-4 text-center mb-3"
          style={{ background: profile.primary_color, color: '#fff' }}
        >
          <p className="font-bold">{profile.name}</p>
          {profile.tagline && <p className="text-xs opacity-80 mt-1">{profile.tagline}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-[var(--text-3)]">{t(isHi, 'Slug:', 'स्लग:')}</span>{' '}
            <span className="font-mono font-semibold">{profile.slug}</span>
          </div>
          <div>
            <span className="text-[var(--text-3)]">{t(isHi, 'Logo:', 'लोगो:')}</span>{' '}
            <span className="font-semibold">{profile.logo_url ? 'Set' : 'Not set'}</span>
          </div>
        </div>
      </Card>

      {/* Classes Summary */}
      <Card accent="#16A34A">
        <h3 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wider mb-3">
          {t(isHi, `Classes (${classes.length})`, `कक्षाएं (${classes.length})`)}
        </h3>
        {classes.length === 0 ? (
          <p className="text-sm text-[var(--text-3)]">
            {t(isHi, 'No classes created yet', 'अभी तक कोई कक्षा नहीं बनाई गई')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {classes.map((cls) => (
              <Badge key={cls.id} color="#16A34A">
                {cls.name} (Gr. {cls.grade})
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {/* Invite Codes Summary */}
      <Card accent="#F97316">
        <h3 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wider mb-3">
          {t(isHi, `Invite Codes (${inviteCodes.length})`, `आमंत्रण कोड (${inviteCodes.length})`)}
        </h3>
        {inviteCodes.length === 0 ? (
          <p className="text-sm text-[var(--text-3)]">
            {t(isHi, 'No codes generated yet', 'अभी तक कोई कोड नहीं बनाया गया')}
          </p>
        ) : (
          <div className="space-y-2">
            {inviteCodes.map((ic) => (
              <div key={ic.id} className="flex items-center gap-2">
                <span
                  className="font-mono text-sm font-bold tracking-wider"
                  style={{ color: 'var(--text-1)' }}
                >
                  {ic.code}
                </span>
                <Badge color={ic.role === 'teacher' ? '#7C3AED' : '#F97316'}>
                  {ic.role}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Button
        variant="primary"
        fullWidth
        size="lg"
        onClick={onLaunch}
        disabled={launching}
      >
        {launching
          ? t(isHi, 'Launching...', 'लॉन्च हो रहा है...')
          : t(isHi, 'Launch School', 'स्कूल लॉन्च करें')} 🚀
      </Button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   SKELETON LOADING STATE
───────────────────────────────────────────────────────────── */
function SetupSkeleton() {
  return (
    <div className="px-4 pt-4 pb-24 max-w-lg mx-auto space-y-5">
      <Skeleton variant="rect" height={8} width="60%" rounded="rounded-full" className="mx-auto" />
      <Skeleton variant="circle" height={60} width={60} className="mx-auto" />
      <Skeleton variant="title" height={24} width="50%" className="mx-auto" />
      <Skeleton variant="text" height={14} width="70%" className="mx-auto" />
      <div className="space-y-4 mt-6">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} variant="rect" height={48} rounded="rounded-xl" />
        ))}
      </div>
      <Skeleton variant="rect" height={52} rounded="rounded-2xl" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE COMPONENT
───────────────────────────────────────────────────────────── */
export default function SchoolAdminSetupPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi } = useAuth();

  /* ── state ── */
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);

  const [profile, setProfile] = useState<SchoolProfile | null>(null);
  const [createdClasses, setCreatedClasses] = useState<CreatedClass[]>([]);
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);

  /* ── auth guard ── */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* ── bootstrap: fetch school profile ── */
  const bootstrap = useCallback(async () => {
    if (!authUserId) return;

    setLoading(true);
    setError(null);

    try {
      // Get admin record to find school_id
      const { data: adminRecord, error: adminErr } = await supabase
        .from('school_admins')
        .select('school_id')
        .eq('auth_user_id', authUserId)
        .eq('is_active', true)
        .maybeSingle();

      if (adminErr) throw new Error(adminErr.message);

      if (!adminRecord) {
        router.replace('/login');
        return;
      }

      // Fetch school profile
      const { data: school, error: schoolErr } = await supabase
        .from('schools')
        .select('id, name, slug, tagline, logo_url, primary_color, secondary_color')
        .eq('id', adminRecord.school_id)
        .single();

      if (schoolErr) throw new Error(schoolErr.message);

      setProfile(school as SchoolProfile);

      // Also fetch any existing classes for this school
      const { data: existingClasses } = await supabase
        .from('classes')
        .select('id, name, grade, section')
        .eq('school_id', adminRecord.school_id)
        .order('grade', { ascending: true });

      if (existingClasses && existingClasses.length > 0) {
        setCreatedClasses(existingClasses as CreatedClass[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load school data');
    } finally {
      setLoading(false);
    }
  }, [authUserId, router]);

  useEffect(() => {
    if (!authLoading && authUserId) {
      bootstrap();
    }
  }, [authLoading, authUserId, bootstrap]);

  /* ── Step 1: Save profile ── */
  async function handleSaveProfile(updates: Partial<SchoolProfile>): Promise<boolean> {
    if (!profile) return false;

    setSaving(true);
    try {
      const res = await fetch('/api/schools/setup/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school_id: profile.id,
          ...updates,
        }),
      });

      const result = await res.json();

      if (!result.success) {
        setError(result.error || 'Failed to save profile');
        setSaving(false);
        return false;
      }

      setProfile((prev) => (prev ? { ...prev, ...result.data } : prev));
      setStep(1);
      setSaving(false);
      return true;
    } catch {
      setError(t(isHi, 'Network error', 'नेटवर्क त्रुटि'));
      setSaving(false);
      return false;
    }
  }

  /* ── Step 4: Launch school ── */
  async function handleLaunch() {
    if (!profile) return;

    setLaunching(true);
    try {
      // Mark setup as complete by updating school settings
      const res = await fetch('/api/schools/setup/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school_id: profile.id,
          // Settings update with setup_complete flag is handled by the API
          // For now we just navigate to the dashboard
        }),
      });

      // Even if the settings update fails, navigate to the dashboard
      // The school is operational once classes and codes exist
      router.push('/school-admin');
    } catch {
      // Navigate anyway
      router.push('/school-admin');
    } finally {
      setLaunching(false);
    }
  }

  /* ── Render ── */
  if (authLoading || loading) {
    return (
      <div style={{ background: 'var(--bg)' }} className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
        <header
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
          style={{
            background: 'rgba(251,248,244,0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="rect" height={36} width={36} rounded="rounded-xl" />
          <Skeleton variant="title" height={22} width="45%" />
        </header>
        <SetupSkeleton />
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center px-4 font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
        style={{ background: 'var(--bg)' }}
      >
        <Card className="max-w-xs w-full text-center py-8">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-[var(--text-2)] mb-4">{error}</p>
          <Button variant="primary" onClick={bootstrap}>
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </Button>
        </Card>
      </div>
    );
  }

  if (!profile) return null;

  const STEPS = [
    { label: t(isHi, 'Profile', 'प्रोफ़ाइल'), icon: '🏫' },
    { label: t(isHi, 'Classes', 'कक्षाएं'), icon: '📚' },
    { label: t(isHi, 'Invite', 'आमंत्रण'), icon: '🔑' },
    { label: t(isHi, 'Launch', 'लॉन्च'), icon: '🚀' },
  ];

  return (
    <div
      style={{ background: 'var(--bg)' }}
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
    >
      {/* STICKY HEADER */}
      <header
        className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'rgba(251,248,244,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => {
            if (step > 0) {
              setStep(step - 1);
            } else {
              router.push('/school-admin');
            }
          }}
          className="rounded-xl flex items-center justify-center transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
          style={{
            width: '40px',
            height: '40px',
            minWidth: '40px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            fontSize: '18px',
          }}
          aria-label={
            step > 0
              ? t(isHi, 'Previous step', 'पिछला चरण')
              : t(isHi, 'Back to dashboard', 'डैशबोर्ड पर वापस जाएं')
          }
        >
          ←
        </button>

        <div className="flex-1 min-w-0">
          <h1
            className="text-base font-bold text-[var(--text-1)] truncate"
            style={{ fontFamily: 'Sora, system-ui, sans-serif' }}
          >
            {t(isHi, 'School Setup', 'स्कूल सेटअप')}
          </h1>
          <p className="text-xs text-[var(--text-3)]">
            {STEPS[step].icon} {STEPS[step].label}
          </p>
        </div>
      </header>

      {/* Step indicator */}
      <div className="flex justify-center pt-4 pb-2">
        <StepIndicator total={4} current={step} color="#7C3AED" />
      </div>

      {/* Step labels */}
      <div className="flex justify-center gap-4 px-4 pb-4">
        {STEPS.map((s, idx) => (
          <button
            key={idx}
            onClick={() => {
              // Allow navigating back to completed steps
              if (idx <= step) setStep(idx);
            }}
            className="text-xs font-medium transition-colors"
            style={{
              color: idx === step ? '#7C3AED' : idx < step ? 'var(--text-2)' : 'var(--text-3)',
              cursor: idx <= step ? 'pointer' : 'default',
              opacity: idx > step ? 0.5 : 1,
            }}
            disabled={idx > step}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-3 rounded-xl p-3 text-center" style={{ background: '#FEE2E2', border: '1px solid #FCA5A5' }}>
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-xs text-red-500 font-semibold mt-1"
          >
            {t(isHi, 'Dismiss', 'बंद करें')}
          </button>
        </div>
      )}

      {/* STEP CONTENT */}
      <main className="px-4 pb-24 max-w-lg mx-auto">
        {step === 0 && (
          <Step1Profile
            profile={profile}
            isHi={isHi}
            onSave={handleSaveProfile}
            saving={saving}
          />
        )}

        {step === 1 && (
          <Step2Classes
            createdClasses={createdClasses}
            schoolId={profile.id}
            isHi={isHi}
            onClassesCreated={setCreatedClasses}
            onNext={() => setStep(2)}
          />
        )}

        {step === 2 && (
          <Step3InviteCodes
            schoolId={profile.id}
            schoolSlug={profile.slug}
            classes={createdClasses}
            inviteCodes={inviteCodes}
            isHi={isHi}
            onCodesGenerated={setInviteCodes}
            onNext={() => setStep(3)}
          />
        )}

        {step === 3 && (
          <Step4Review
            profile={profile}
            classes={createdClasses}
            inviteCodes={inviteCodes}
            isHi={isHi}
            onLaunch={handleLaunch}
            launching={launching}
          />
        )}
      </main>

      <BottomNav />
    </div>
  );
}