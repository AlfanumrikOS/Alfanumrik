import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface NavItem { label: string; href: string; icon: string; }

const NAV: Record<string, NavItem[]> = {
  student: [
    { label: 'Dashboard', href: '/dashboard', icon: '📊' },
    { label: 'Foxy Tutor', href: '/dashboard/foxy', icon: '🦊' },
    { label: 'My Parents', href: '/dashboard/connections', icon: '👨‍👩‍👧' },
  ],
  parent: [
    { label: 'My Children', href: '/parent', icon: '👧' },
    { label: 'Connections', href: '/parent/connections', icon: '🔗' },
  ],
  super_admin: [
    { label: 'Overview', href: '/admin', icon: '📊' },
    { label: 'Users', href: '/admin/users', icon: '👥' },
    { label: 'Mappings', href: '/admin/mappings', icon: '🔗' },
    { label: 'Audit Logs', href: '/admin/audit', icon: '📋' },
  ],
  admin: [
    { label: 'Overview', href: '/admin', icon: '📊' },
    { label: 'Users', href: '/admin/users', icon: '👥' },
    { label: 'Mappings', href: '/admin/mappings', icon: '🔗' },
    { label: 'Audit Logs', href: '/admin/audit', icon: '📋' },
  ],
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, role, profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navItems = NAV[role] || [];
  const displayName = (profile as { name?: string })?.name || user?.email?.split('@')[0] || 'User';
  const displayEmail = user?.email || '';
  const roleLabel = role === 'super_admin' ? 'Super Admin' : role === 'admin' ? 'Admin' : role === 'parent' ? 'Parent' : 'Student';

  const handleSignOut = async () => { await signOut(); navigate('/login'); };

  return (
    <div className="min-h-screen flex bg-slate-50" style={{ fontFamily: 'Nunito, sans-serif' }}>
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col fixed h-full z-20 shadow-sm">
        <div className="p-5 border-b border-slate-100">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-2xl">🦊</span>
            <span className="text-lg font-extrabold"
              style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Alfanumrik
            </span>
          </Link>
          <div className="mt-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">{roleLabel}</div>
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const active = location.pathname === item.href;
            return (
              <Link key={item.href} to={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  active ? 'bg-orange-50 text-orange-600 shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`}>
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
              style={{ background: 'linear-gradient(135deg, #f97316, #7c3aed)' }}>
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{displayName}</p>
              <p className="text-xs text-slate-400 truncate">{displayEmail}</p>
            </div>
          </div>
          <button onClick={handleSignOut}
            className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg font-medium transition-colors">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 ml-60 p-6 lg:p-8">{children}</main>
    </div>
  );
}
