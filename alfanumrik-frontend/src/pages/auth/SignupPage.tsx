import { useState, FormEvent, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import AuthLayout from '../../components/auth/AuthLayout';

const GRADES = ['Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
const LANGUAGES = [
  { value: 'en', label: 'English' }, { value: 'hi', label: 'हिन्दी (Hindi)' },
  { value: 'bn', label: 'বাংলা (Bengali)' }, { value: 'ta', label: 'தமிழ் (Tamil)' },
  { value: 'te', label: 'తెలుగు (Telugu)' },
];

export default function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteParam = searchParams.get('invite');
  const { signUp, signInWithGoogle, user, role: currentRole, loading } = useAuth();

  const [step, setStep] = useState<'role'|'form'>(inviteParam ? 'form' : 'role');
  const [selectedRole, setSelectedRole] = useState<'student'|'parent'>(inviteParam ? 'parent' : 'student');
  const [form, setForm] = useState({ name:'', email:'', password:'', confirmPassword:'', grade:'Grade 9', language:'en', board:'CBSE', phone:'', relationship:'parent' });
  const [error, setError] = useState<string|null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!loading && user && currentRole !== 'unknown') {
      navigate(currentRole === 'student' ? '/dashboard' : currentRole === 'parent' ? '/parent' : '/admin', { replace: true });
    }
  }, [loading, user, currentRole, navigate]);

  const set = (field: string, val: string) => { setForm(prev => ({ ...prev, [field]: val })); setError(null); };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return; }
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSubmitting(true);
    const metadata: Record<string,string> = { role: selectedRole === 'parent' ? 'parent' : 'student', full_name: form.name.trim(), name: form.name.trim() };
    if (selectedRole === 'student') { metadata.grade = form.grade; metadata.board = form.board; metadata.language = form.language; }
    else { metadata.relationship = form.relationship; if (form.phone) metadata.phone = form.phone; }
    const { error: err } = await signUp(form.email.trim(), form.password, metadata);
    setSubmitting(false);
    if (err) setError(err); else setSuccess(true);
  };

  const handleGoogleSignup = async () => { setError(null); const { error: err } = await signInWithGoogle(selectedRole); if (err) setError(err); };

  if (loading) return null;

  if (success) {
    return (
      <AuthLayout>
        <div className="text-center py-8">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-extrabold text-slate-900 mb-3">Account created!</h2>
          <p className="text-slate-500 mb-2">Check your email for a verification link.</p>
          <p className="text-slate-400 text-sm mb-6">Once verified, you can sign in.</p>
          <Link to="/login" className="inline-block px-8 py-3 text-white font-bold rounded-xl text-sm shadow-md" style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>Go to Sign In</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="text-3xl font-extrabold text-slate-900 mb-1">Create account</h2>
      <p className="text-slate-400 mb-6 text-[15px]">{inviteParam ? "You've been invited! Sign up to connect." : 'Join Alfanumrik and learn with Foxy 🦊'}</p>

      {error && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-medium">{error}</div>}

      {step === 'role' && (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-slate-600 mb-3">I am a…</p>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => { setSelectedRole('student'); setStep('form'); }}
              className="p-6 border-2 border-slate-200 rounded-2xl text-center hover:border-orange-400 hover:bg-orange-50/30 transition-all group">
              <span className="text-4xl block mb-2 group-hover:scale-110 transition-transform">🎓</span>
              <span className="font-bold text-slate-800 block">Student</span>
              <span className="text-xs text-slate-400 mt-1 block">I want to learn</span>
            </button>
            <button onClick={() => { setSelectedRole('parent'); setStep('form'); }}
              className="p-6 border-2 border-slate-200 rounded-2xl text-center hover:border-purple-400 hover:bg-purple-50/30 transition-all group">
              <span className="text-4xl block mb-2 group-hover:scale-110 transition-transform">👨‍👩‍👧</span>
              <span className="font-bold text-slate-800 block">Parent</span>
              <span className="text-xs text-slate-400 mt-1 block">Track my child</span>
            </button>
          </div>
          <p className="mt-5 text-center text-slate-400 text-sm">Already have an account? <Link to="/login" className="font-bold text-purple-600">Sign in</Link></p>
        </div>
      )}

      {step === 'form' && (
        <>
          <button onClick={() => { setStep('role'); setError(null); }} className="text-xs font-semibold text-orange-500 hover:text-orange-600 mb-4 flex items-center gap-1">
            ← Change role
            <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: selectedRole === 'student' ? '#f97316' : '#7c3aed' }}>
              {selectedRole === 'student' ? '🎓 Student' : '👨‍👩‍👧 Parent'}
            </span>
          </button>

          <button onClick={handleGoogleSignup} type="button"
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border-2 border-slate-200 rounded-xl text-slate-700 font-semibold text-sm hover:border-slate-300 hover:bg-slate-50 transition-all mb-4">
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/></svg>
            Sign up with Google
          </button>

          <div className="flex items-center gap-3 mb-4"><div className="h-px bg-slate-200 flex-1"/><span className="text-xs text-slate-400">OR</span><div className="h-px bg-slate-200 flex-1"/></div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-sm font-semibold text-slate-600 mb-1">Full Name</label>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} required placeholder="Your full name"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none"/>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} required placeholder="you@example.com"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1">Password</label>
                <input type="password" value={form.password} onChange={e => set('password', e.target.value)} required placeholder="Min 6 chars"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:border-orange-400 outline-none"/>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1">Confirm</label>
                <input type="password" value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} required placeholder="Re-enter"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:border-orange-400 outline-none"/>
              </div>
            </div>

            {selectedRole === 'student' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1">Class</label>
                  <select value={form.grade} onChange={e => set('grade', e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white text-slate-800 focus:border-orange-400 outline-none">
                    {GRADES.map(g => <option key={g} value={g}>{g.replace('Grade ','Class ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1">Language</label>
                  <select value={form.language} onChange={e => set('language', e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white text-slate-800 focus:border-orange-400 outline-none">
                    {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            {selectedRole === 'parent' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1">Phone <span className="text-slate-300 font-normal">(optional)</span></label>
                  <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+91 98765 43210"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:border-orange-400 outline-none"/>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1">Relationship</label>
                  <select value={form.relationship} onChange={e => set('relationship', e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white text-slate-800 focus:border-orange-400 outline-none">
                    <option value="parent">Parent</option><option value="guardian">Guardian</option>
                    <option value="teacher">Teacher</option><option value="tutor">Tutor</option>
                  </select>
                </div>
              </div>
            )}

            <button type="submit" disabled={submitting}
              className="w-full py-3 text-white font-bold rounded-xl text-sm hover:opacity-90 disabled:opacity-50 shadow-md mt-1"
              style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>
              {submitting ? 'Creating account…' : 'Create Account'}
            </button>
          </form>

          <p className="mt-5 text-center text-slate-400 text-sm">Already have an account? <Link to="/login" className="font-bold text-purple-600">Sign in</Link></p>
        </>
      )}
    </AuthLayout>
  );
}
