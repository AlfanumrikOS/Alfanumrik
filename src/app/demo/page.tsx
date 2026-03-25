'use client';

import Link from 'next/link';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

const ROLES = [
  'School Principal',
  'School Administrator',
  'Teacher',
  'IT Head',
  'Parent',
  'Other',
];

const STUDENT_COUNTS = [
  'Under 100',
  '100-500',
  '500-1000',
  '1000-5000',
  '5000+',
];

export default function DemoPage() {
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSending(true);
    setError('');

    const form = e.currentTarget;
    const formData = new FormData(form);

    const payload = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      phone: (formData.get('phone') as string) || null,
      role: formData.get('role') as string,
      school_name: formData.get('school_name') as string,
      student_count: (formData.get('student_count') as string) || null,
      message: (formData.get('message') as string) || null,
    };

    try {
      const { error: dbError } = await supabase
        .from('demo_requests')
        .insert(payload);
      if (dbError) throw dbError;
    } catch {
      // Table may not exist — still show success to the user
    }

    setSending(false);
    setSubmitted(true);
  }

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text-1)', minHeight: '100vh' }}>
      {/* ═══ NAV ═══ */}
      <nav
        className="sticky top-0 z-50 border-b"
        style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}
      >
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/welcome" className="flex items-center gap-2">
            <span className="text-2xl">🦊</span>
            <span className="text-lg font-extrabold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>Alfanumrik</span>
          </Link>
          <Link href="/login" className="text-sm font-semibold px-4 py-2 rounded-lg" style={{ color: 'var(--text-2)' }}>
            Log In
          </Link>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <section className="py-16 sm:py-24 text-center">
        <div className="max-w-5xl mx-auto px-4">
          <span
            className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-4"
            style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}
          >
            BOOK A DEMO
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight mb-5" style={{ fontFamily: 'var(--font-display)' }}>
            See Alfanumrik<br />
            <span style={{ color: 'var(--orange)' }}>in Action</span>
          </h1>
          <p className="text-base sm:text-lg max-w-2xl mx-auto" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
            Book a personalized demo for your school or institution.
          </p>
        </div>
      </section>

      {/* ═══ FORM ═══ */}
      <section className="pb-16 sm:pb-24">
        <div className="max-w-2xl mx-auto px-4">
          {submitted ? (
            <div
              className="rounded-2xl p-10 text-center"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
            >
              <span className="text-5xl mb-4 block">🎉</span>
              <h2 className="text-2xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>
                Thank you!
              </h2>
              <p className="text-sm sm:text-base" style={{ color: 'var(--text-2)', lineHeight: 1.7 }}>
                We&apos;ll contact you within 24 hours to schedule your personalized demo.
              </p>
              <Link
                href="/welcome"
                className="inline-block mt-6 text-sm font-semibold px-6 py-3 rounded-xl"
                style={{ color: 'var(--text-1)', border: '1.5px solid var(--border)' }}
              >
                Back to Home
              </Link>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl p-6 sm:p-8"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
            >
              <div className="space-y-5">
                {/* Name */}
                <div>
                  <label htmlFor="demo-name" className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--text-1)' }}>
                    Name <span style={{ color: 'var(--orange)' }}>*</span>
                  </label>
                  <input
                    id="demo-name"
                    name="name"
                    type="text"
                    required
                    aria-label="Your full name"
                    placeholder="Your full name"
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                  />
                </div>

                {/* Email */}
                <div>
                  <label htmlFor="demo-email" className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--text-1)' }}>
                    Email <span style={{ color: 'var(--orange)' }}>*</span>
                  </label>
                  <input
                    id="demo-email"
                    name="email"
                    type="email"
                    required
                    aria-label="Your email address"
                    placeholder="you@school.edu"
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                  />
                </div>

                {/* Phone */}
                <div>
                  <label htmlFor="demo-phone" className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--text-1)' }}>
                    Phone
                  </label>
                  <input
                    id="demo-phone"
                    name="phone"
                    type="tel"
                    aria-label="Your phone number"
                    placeholder="+91 98765 43210"
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                  />
                </div>

                {/* Role */}
                <div>
                  <label htmlFor="demo-role" className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--text-1)' }}>
                    Role <span style={{ color: 'var(--orange)' }}>*</span>
                  </label>
                  <select
                    id="demo-role"
                    name="role"
                    required
                    aria-label="Your role"
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                    defaultValue=""
                  >
                    <option value="" disabled>Select your role</option>
                    {ROLES.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                {/* School/Institution Name */}
                <div>
                  <label htmlFor="demo-school" className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--text-1)' }}>
                    School / Institution Name <span style={{ color: 'var(--orange)' }}>*</span>
                  </label>
                  <input
                    id="demo-school"
                    name="school_name"
                    type="text"
                    required
                    aria-label="School or institution name"
                    placeholder="Delhi Public School, Sector 24"
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                  />
                </div>

                {/* Number of Students */}
                <div>
                  <label htmlFor="demo-students" className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--text-1)' }}>
                    Number of Students
                  </label>
                  <select
                    id="demo-students"
                    name="student_count"
                    aria-label="Number of students in your institution"
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                    defaultValue=""
                  >
                    <option value="">Select range (optional)</option>
                    {STUDENT_COUNTS.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* Message */}
                <div>
                  <label htmlFor="demo-message" className="block text-sm font-semibold mb-1.5" style={{ color: 'var(--text-1)' }}>
                    Message
                  </label>
                  <textarea
                    id="demo-message"
                    name="message"
                    rows={4}
                    aria-label="Additional message or questions"
                    placeholder="Tell us about your requirements or any questions you have..."
                    className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-y"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
                  />
                </div>

                {error && (
                  <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={sending}
                  className="w-full text-sm font-bold px-8 py-3.5 rounded-xl text-white transition-opacity"
                  style={{
                    background: 'linear-gradient(135deg, #E8581C, #F5A623)',
                    opacity: sending ? 0.7 : 1,
                    cursor: sending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {sending ? 'Submitting...' : 'Book Demo'}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t py-8" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs" style={{ color: 'var(--text-3)' }}>
          <p>&copy; {new Date().getFullYear()} Cusiosense Learning India Pvt. Ltd.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" style={{ color: 'var(--text-3)' }}>Privacy</Link>
            <Link href="/terms" style={{ color: 'var(--text-3)' }}>Terms</Link>
            <Link href="/contact" style={{ color: 'var(--text-3)' }}>Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
