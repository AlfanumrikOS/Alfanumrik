import { useState, FormEvent, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import AuthLayout from '../../components/auth/AuthLayout';

const ROLE_HOME: Record<string, string> = {
  super_admin: '/admin', admin: '/admin', student: '/dashboard', parent: '/parent',
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { signIn, signInWithGoogle, role, user, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw] = useState(false);

  useEffect(() => {
    if (!loading && user && role !== 'unknown') {
      navigate(ROLE_HOME[role] || '/dashboard', { replace: true });
    }
  }, [loading, user, role, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: err } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (err) setError(err === 'Invalid login credentials' ? 'Invalid email or password.' : err);
  };

  const handleGoogle = async () => {
    setError(null);
    const { error: err } = await signInWithGoogle();
    if (err) setError(err);
  };

  if (loading || (user && role !== 'unknown')) return null;

  return (
    <AuthLayout>
      <h2 className="text-3xl font-extrabold text-slate-900 mb-1">Welcome back</h2>
      <p className="text-slate-400 mb-7 text-[15px]">Sign in to continue learning with Foxy 🦊</p>

      {error && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-medium">{error}</div>
      )}

      <button onClick={handleGoogle} type="button"
        className="w-full flex items-center justify-center gap-3 px-4 py-3 border-2 border-slate-200 rounded-xl text-slate-700 font-semibold text-sm hover:border-slate-300 hover:bg-slate-50 transition-all mb-5">
        <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/><path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/></svg>
        Continue with Google
      </button>

      <div className="flex items-center gap-3 mb-5">
        <div className="h-px bg-slate-200 flex-1"/><span className="text-xs text-slate-400 font-medium">OR</span><div className="h-px bg-slate-200 flex-1"/>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-600 mb-1.5">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com"
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none text-sm"/>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-semibold text-slate-600">Password</label>
            <Link to="/forgot-password" className="text-xs font-semibold text-orange-500 hover:text-orange-600">Forgot?</Link>
          </div>
          <div className="relative">
            <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" placeholder="••••••••"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-300 pr-16 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none text-sm"/>
            <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 font-semibold">
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <button type="submit" disabled={submitting}
          className="w-full py-3.5 text-white font-bold rounded-xl text-sm hover:opacity-90 disabled:opacity-50 shadow-md"
          style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>

      <p className="mt-7 text-center text-slate-400 text-sm">
        Don't have an account? <Link to="/signup" className="font-bold text-purple-600 hover:text-purple-700">Sign up</Link>
      </p>
    </AuthLayout>
  );
}
