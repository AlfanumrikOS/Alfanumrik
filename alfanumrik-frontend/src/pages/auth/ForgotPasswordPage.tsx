import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import AuthLayout from '../../components/auth/AuthLayout';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setError(null); setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (err) setError(err.message); else setSent(true);
  };

  if (sent) {
    return (
      <AuthLayout>
        <div className="text-center py-4">
          <div className="text-5xl mb-4">📧</div>
          <h2 className="text-2xl font-extrabold text-slate-900 mb-3">Check your email</h2>
          <p className="text-slate-500 mb-6 text-sm">If an account exists for <strong>{email}</strong>, we've sent a reset link.</p>
          <Link to="/login" className="text-purple-600 font-bold text-sm">← Back to sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="text-3xl font-extrabold text-slate-900 mb-1">Forgot password?</h2>
      <p className="text-slate-400 mb-7 text-[15px]">Enter your email to receive a reset link.</p>
      {error && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-medium">{error}</div>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-600 mb-1.5">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com"
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none"/>
        </div>
        <button type="submit" disabled={loading}
          className="w-full py-3.5 text-white font-bold rounded-xl text-sm hover:opacity-90 disabled:opacity-50 shadow-md"
          style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>
          {loading ? 'Sending…' : 'Send Reset Link'}
        </button>
      </form>
      <p className="mt-6 text-center"><Link to="/login" className="text-purple-600 font-bold text-sm">← Back to sign in</Link></p>
    </AuthLayout>
  );
}
