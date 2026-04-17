'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { LangProvider, LangToggle, useLang } from '@/components/landing/LangToggle';

/* ─── Data ─── */

const FEATURES = [
  {
    icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    title: 'Adaptive Learning',
    titleHi: 'अनुकूली शिक्षा',
    desc: 'AI-powered Foxy tutor for every student, adapting to their pace and learning style.',
    descHi: 'हर छात्र के लिए AI-संचालित Foxy ट्यूटर, उनकी गति और सीखने की शैली के अनुसार।',
  },
  {
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    title: 'Academic Reports',
    titleHi: 'शैक्षणिक रिपोर्ट',
    desc: 'Per-class and per-student analytics with board exam readiness tracking.',
    descHi: 'बोर्ड परीक्षा तैयारी ट्रैकिंग के साथ कक्षा-वार और छात्र-वार एनालिटिक्स।',
  },
  {
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
    title: 'Parent Connect',
    titleHi: 'पैरेंट कनेक्ट',
    desc: 'WhatsApp notifications and weekly progress reports for parents.',
    descHi: 'अभिभावकों के लिए WhatsApp नोटिफिकेशन और साप्ताहिक प्रगति रिपोर्ट।',
  },
  {
    icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
    title: 'Custom Content',
    titleHi: 'कस्टम कंटेंट',
    desc: 'Upload school-specific questions and worksheets for your students.',
    descHi: 'अपने छात्रों के लिए स्कूल-विशिष्ट प्रश्न और वर्कशीट अपलोड करें।',
  },
  {
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    title: 'Exam Scheduling',
    titleHi: 'परीक्षा शेड्यूलिंग',
    desc: 'Time-bound assessments for classes with auto-grading and analytics.',
    descHi: 'ऑटो-ग्रेडिंग और एनालिटिक्स के साथ कक्षाओं के लिए समयबद्ध मूल्यांकन।',
  },
  {
    icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01',
    title: 'White-Label Branding',
    titleHi: 'व्हाइट-लेबल ब्रांडिंग',
    desc: "Your school's logo, colors, and custom domain for a branded experience.",
    descHi: 'ब्रांडेड अनुभव के लिए आपके स्कूल का लोगो, रंग और कस्टम डोमेन।',
  },
];

const BOARDS = ['CBSE', 'ICSE', 'State Board'];

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry',
];

/* ─── SVG Icon Component ─── */

function FeatureIcon({ d }: { d: string }) {
  return (
    <svg
      className="w-7 h-7"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

/* ─── Page ─── */

export default function SchoolsPage() {
  return (
    <LangProvider>
      <SchoolsContent />
    </LangProvider>
  );
}

function SchoolsContent() {
  const { t } = useLang();
  const formRef = useRef<HTMLDivElement>(null);

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg, #FBF8F4)', color: 'var(--text-1, #1a1a1a)' }}>
      {/* NAV */}
      <nav
        className="sticky top-0 z-50 border-b"
        style={{
          background: 'rgba(251,248,244,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/welcome" className="flex items-center gap-2">
            <span className="text-2xl">🦊</span>
            <span
              className="text-lg font-extrabold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
            >
              Alfanumrik
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <LangToggle />
            <Link
              href="/login"
              className="text-sm font-semibold px-4 py-2 rounded-lg"
              style={{ color: 'var(--text-2)' }}
            >
              {t('Log In', 'लॉग इन')}
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="py-16 sm:py-24 text-center">
        <div className="max-w-5xl mx-auto px-4">
          <span
            className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-4"
            style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}
          >
            {t('FOR SCHOOLS', 'स्कूलों के लिए')}
          </span>
          <h1
            className="text-3xl sm:text-5xl font-extrabold leading-tight mb-5"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t(
              'Transform Your School with',
              'AI-संचालित शिक्षा से'
            )}
            <br />
            <span style={{ color: '#F97316' }}>
              {t('AI-Powered Learning', 'अपने स्कूल को बदलें')}
            </span>
          </h1>
          <p
            className="text-base sm:text-lg max-w-2xl mx-auto mb-4"
            style={{ color: 'var(--text-2)', lineHeight: 1.7 }}
          >
            {t(
              'CBSE-aligned adaptive learning for grades 6-12. Used by 10,000+ students across India.',
              'CBSE-अनुरूप अनुकूली शिक्षा, कक्षा 6-12 के लिए। भारत भर में 10,000+ छात्रों द्वारा उपयोग किया जा रहा है।'
            )}
          </p>
          <button
            onClick={scrollToForm}
            className="text-sm font-bold px-8 py-3.5 rounded-xl text-white mt-4"
            style={{ background: 'linear-gradient(135deg, #7C3AED, #F97316)', minHeight: 44, minWidth: 44 }}
          >
            {t('Start Free Trial', 'मुफ्त ट्रायल शुरू करें')}
          </button>
        </div>
      </section>

      {/* FEATURES GRID */}
      <section className="py-14 sm:py-20" style={{ background: 'var(--surface-1, #f5f2ed)' }}>
        <div className="max-w-5xl mx-auto px-4">
          <h2
            className="text-2xl sm:text-3xl font-extrabold text-center mb-10"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t('Everything Your School Needs', 'आपके स्कूल को जो कुछ भी चाहिए')}
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl p-6"
                style={{ background: 'var(--bg, #FBF8F4)', border: '1px solid var(--border)' }}
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}
                >
                  <FeatureIcon d={f.icon} />
                </div>
                <h3 className="text-base font-bold mb-2" style={{ color: 'var(--text-1)' }}>
                  {t(f.title, f.titleHi)}
                </h3>
                <p className="text-sm" style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
                  {t(f.desc, f.descHi)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="py-14 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2
            className="text-2xl sm:text-3xl font-extrabold mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t('Simple, Transparent Pricing', 'सरल, पारदर्शी मूल्य')}
          </h2>
          <p className="text-sm sm:text-base mb-8" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            {t(
              'One plan, all features included. Volume discounts for large schools.',
              'एक प्लान, सभी सुविधाएं शामिल। बड़े स्कूलों के लिए वॉल्यूम डिस्काउंट।'
            )}
          </p>

          <div
            className="rounded-2xl p-8 sm:p-10 text-left mx-auto max-w-lg"
            style={{
              background: 'var(--bg, #FBF8F4)',
              border: '2px solid #7C3AED',
              boxShadow: '0 4px 24px rgba(124,58,237,0.10)',
            }}
          >
            <div className="flex items-baseline gap-1 mb-2">
              <span className="text-4xl font-extrabold" style={{ color: '#7C3AED' }}>
                ₹75
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>
                {t('/student/month', '/छात्र/माह')}
              </span>
            </div>
            <p className="text-xs mb-6" style={{ color: 'var(--text-3)' }}>
              {t('Negotiable for 500+ students', '500+ छात्रों के लिए बातचीत योग्य')}
            </p>

            <ul className="space-y-3 mb-6">
              {[
                { en: 'All platform features included', hi: 'सभी प्लेटफ़ॉर्म सुविधाएं शामिल' },
                { en: 'Unlimited quizzes and assessments', hi: 'असीमित क्विज़ और मूल्यांकन' },
                { en: 'AI tutor (Foxy) for every student', hi: 'हर छात्र के लिए AI ट्यूटर (Foxy)' },
                { en: 'Teacher and parent portals', hi: 'शिक्षक और अभिभावक पोर्टल' },
                { en: 'API access and reporting', hi: 'API एक्सेस और रिपोर्टिंग' },
                { en: 'Dedicated onboarding support', hi: 'समर्पित ऑनबोर्डिंग सपोर्ट' },
              ].map((item) => (
                <li key={item.en} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-1)' }}>
                  <svg className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: '#7C3AED' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {t(item.en, item.hi)}
                </li>
              ))}
            </ul>

            <div
              className="rounded-xl p-4 text-center"
              style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)' }}
            >
              <p className="text-sm font-bold" style={{ color: '#F97316' }}>
                {t(
                  'Free 30-day trial with 50 seats — no credit card required',
                  'मुफ्त 30-दिन ट्रायल 50 सीटों के साथ — क्रेडिट कार्ड नहीं चाहिए'
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* TRIAL SIGNUP FORM */}
      <div ref={formRef}>
        <section
          className="py-14 sm:py-20"
          style={{ background: 'var(--surface-1, #f5f2ed)' }}
        >
          <div className="max-w-lg mx-auto px-4">
            <h2
              className="text-2xl sm:text-3xl font-extrabold text-center mb-3"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {t('Start Your Free Trial', 'अपना मुफ्त ट्रायल शुरू करें')}
            </h2>
            <p className="text-sm text-center mb-8" style={{ color: 'var(--text-2)' }}>
              {t(
                '50 student seats for 30 days. No credit card required.',
                '30 दिनों के लिए 50 छात्र सीटें। क्रेडिट कार्ड नहीं चाहिए।'
              )}
            </p>
            <TrialForm />
          </div>
        </section>
      </div>

      {/* FOOTER */}
      <footer className="border-t py-8" style={{ borderColor: 'var(--border)' }}>
        <div
          className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs"
          style={{ color: 'var(--text-3)' }}
        >
          <p>
            {t('Powered by', 'द्वारा संचालित')}{' '}
            <Link href="/welcome" className="font-bold" style={{ color: 'var(--text-2)' }}>
              Alfanumrik
            </Link>{' '}
            &copy; {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" style={{ color: 'var(--text-3)' }}>
              {t('Privacy', 'गोपनीयता')}
            </Link>
            <Link href="/terms" style={{ color: 'var(--text-3)' }}>
              {t('Terms', 'शर्तें')}
            </Link>
            <Link href="/contact" style={{ color: 'var(--text-3)' }}>
              {t('Contact', 'संपर्क')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Trial Signup Form ─── */

interface FormState {
  school_name: string;
  board: string;
  city: string;
  state: string;
  principal_name: string;
  principal_email: string;
  phone: string;
}

function TrialForm() {
  const { t } = useLang();

  const [form, setForm] = useState<FormState>({
    school_name: '',
    board: 'CBSE',
    city: '',
    state: '',
    principal_name: '',
    principal_email: '',
    phone: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);

    // Client-side validation
    if (!form.school_name.trim()) {
      setResult({ success: false, message: t('School name is required.', 'स्कूल का नाम आवश्यक है।') });
      return;
    }
    if (!form.principal_name.trim()) {
      setResult({ success: false, message: t('Principal name is required.', 'प्रिंसिपल का नाम आवश्यक है।') });
      return;
    }
    if (!form.principal_email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.principal_email)) {
      setResult({ success: false, message: t('Valid email is required.', 'वैध ईमेल आवश्यक है।') });
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/schools/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school_name: form.school_name.trim(),
          board: form.board,
          city: form.city.trim() || undefined,
          state: form.state || undefined,
          principal_name: form.principal_name.trim(),
          principal_email: form.principal_email.trim().toLowerCase(),
          phone: form.phone.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setResult({
          success: true,
          message: t(
            'Trial activated! Check your email for login instructions.',
            'ट्रायल सक्रिय! लॉगिन निर्देशों के लिए अपना ईमेल चेक करें।'
          ),
        });
        // Reset form on success
        setForm({
          school_name: '',
          board: 'CBSE',
          city: '',
          state: '',
          principal_name: '',
          principal_email: '',
          phone: '',
        });
      } else {
        setResult({
          success: false,
          message: data.error || t('Something went wrong. Please try again.', 'कुछ गलत हो गया। कृपया पुनः प्रयास करें।'),
        });
      }
    } catch {
      setResult({
        success: false,
        message: t('Network error. Please check your connection.', 'नेटवर्क त्रुटि। कृपया अपना कनेक्शन जांचें।'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 12,
    border: '1.5px solid var(--border)',
    background: 'var(--bg, #FBF8F4)',
    color: 'var(--text-1)',
    fontSize: 14,
    outline: 'none',
    minHeight: 44,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-2)',
    marginBottom: 6,
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* School Name */}
      <div>
        <label htmlFor="school_name" style={labelStyle}>
          {t('School Name', 'स्कूल का नाम')} *
        </label>
        <input
          id="school_name"
          name="school_name"
          type="text"
          required
          value={form.school_name}
          onChange={handleChange}
          placeholder={t('e.g. Delhi Public School, Mathura Road', 'जैसे दिल्ली पब्लिक स्कूल, मथुरा रोड')}
          style={inputStyle}
        />
      </div>

      {/* Board */}
      <div>
        <label htmlFor="board" style={labelStyle}>
          {t('Board', 'बोर्ड')}
        </label>
        <select
          id="board"
          name="board"
          value={form.board}
          onChange={handleChange}
          style={inputStyle}
        >
          {BOARDS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      {/* City + State */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="city" style={labelStyle}>
            {t('City', 'शहर')}
          </label>
          <input
            id="city"
            name="city"
            type="text"
            value={form.city}
            onChange={handleChange}
            placeholder={t('e.g. New Delhi', 'जैसे नई दिल्ली')}
            style={inputStyle}
          />
        </div>
        <div>
          <label htmlFor="state" style={labelStyle}>
            {t('State', 'राज्य')}
          </label>
          <select
            id="state"
            name="state"
            value={form.state}
            onChange={handleChange}
            style={inputStyle}
          >
            <option value="">{t('Select state', 'राज्य चुनें')}</option>
            {INDIAN_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Principal Name */}
      <div>
        <label htmlFor="principal_name" style={labelStyle}>
          {t('Principal / Admin Name', 'प्रिंसिपल / एडमिन का नाम')} *
        </label>
        <input
          id="principal_name"
          name="principal_name"
          type="text"
          required
          value={form.principal_name}
          onChange={handleChange}
          placeholder={t('Full name', 'पूरा नाम')}
          style={inputStyle}
        />
      </div>

      {/* Principal Email */}
      <div>
        <label htmlFor="principal_email" style={labelStyle}>
          {t('Email Address', 'ईमेल पता')} *
        </label>
        <input
          id="principal_email"
          name="principal_email"
          type="email"
          required
          value={form.principal_email}
          onChange={handleChange}
          placeholder={t('principal@school.edu.in', 'principal@school.edu.in')}
          style={inputStyle}
        />
      </div>

      {/* Phone */}
      <div>
        <label htmlFor="phone" style={labelStyle}>
          {t('Phone (optional)', 'फ़ोन (वैकल्पिक)')}
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          value={form.phone}
          onChange={handleChange}
          placeholder="+91 98765 43210"
          style={inputStyle}
        />
      </div>

      {/* Result Message */}
      {result && (
        <div
          className="rounded-xl p-4 text-sm font-medium"
          style={{
            background: result.success ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            color: result.success ? '#16a34a' : '#dc2626',
            border: `1px solid ${result.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
          }}
          role="alert"
        >
          {result.message}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full text-sm font-bold py-3.5 rounded-xl text-white transition-opacity"
        style={{
          background: submitting
            ? 'var(--text-3, #999)'
            : 'linear-gradient(135deg, #7C3AED, #F97316)',
          minHeight: 44,
          opacity: submitting ? 0.7 : 1,
          cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting
          ? t('Submitting...', 'सबमिट हो रहा है...')
          : t('Start Free Trial', 'मुफ्त ट्रायल शुरू करें')}
      </button>

      <p className="text-xs text-center" style={{ color: 'var(--text-3)' }}>
        {t(
          'By signing up, you agree to our Terms of Service and Privacy Policy.',
          'साइन अप करके, आप हमारी सेवा की शर्तों और गोपनीयता नीति से सहमत होते हैं।'
        )}
      </p>
    </form>
  );
}
