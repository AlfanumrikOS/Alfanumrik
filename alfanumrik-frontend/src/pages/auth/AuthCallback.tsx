import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { user, role, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (user && role !== 'unknown') {
      const dest = role === 'student' ? '/dashboard' : role === 'parent' ? '/parent' : '/admin';
      navigate(dest, { replace: true });
    } else if (!user && !loading) {
      navigate('/login', { replace: true });
    }
  }, [user, role, loading, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50" style={{ fontFamily: 'Nunito, sans-serif' }}>
      <div className="text-center">
        <div className="text-5xl mb-4 animate-bounce">🦊</div>
        <p className="text-slate-500 font-semibold">Signing you in…</p>
      </div>
    </div>
  );
}
