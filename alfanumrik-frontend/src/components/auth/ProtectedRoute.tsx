import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { UserRole } from '../../types/auth';

interface Props {
  children: ReactNode;
  allowedRoles: UserRole[];
}

const ROLE_HOME: Record<string, string> = {
  super_admin: '/admin',
  admin: '/admin',
  student: '/dashboard',
  parent: '/parent',
};

export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🦊</div>
          <p className="text-slate-500 font-semibold text-lg" style={{ fontFamily: 'Nunito, sans-serif' }}>
            Loading Alfanumrik...
          </p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!allowedRoles.includes(role)) {
    return <Navigate to={ROLE_HOME[role] || '/login'} replace />;
  }

  return <>{children}</>;
}
