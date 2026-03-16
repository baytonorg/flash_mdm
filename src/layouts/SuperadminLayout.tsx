import { Outlet, NavLink, useNavigate, Navigate } from 'react-router';
import { useAuthStore } from '@/stores/auth';
import { useState, useCallback } from 'react';
import {
  LayoutDashboard, Building2, BarChart3, ArrowLeft, Shield, Menu, X, Users,
} from 'lucide-react';
import { BRAND } from '@/lib/brand';

const navItems = [
  { to: '/superadmin', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/superadmin/workspaces', icon: Building2, label: 'Workspaces' },
  { to: '/superadmin/users', icon: Users, label: 'Users' },
  { to: '/superadmin/stats', icon: BarChart3, label: 'Platform Stats' },
];

export default function SuperadminLayout() {
  const { user, isLoading } = useAuthStore();
  const navigate = useNavigate();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const handleNavClick = useCallback(() => {
    if (window.innerWidth < 768) {
      closeMobileSidebar();
    }
  }, [closeMobileSidebar]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin h-8 w-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user?.is_superadmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen flex">
      {/* Mobile backdrop overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={closeMobileSidebar}
          data-testid="superadmin-sidebar-backdrop"
        />
      )}

      {/* Dark sidebar */}
      <aside
        className={`
          ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 text-gray-100 flex flex-col transition-transform duration-200
          md:static md:translate-x-0
        `}
        data-testid="superadmin-sidebar"
      >
        {/* Logo + Badge */}
        <div className="h-16 flex items-center gap-3 px-4 border-b border-gray-800">
          <Shield className="w-5 h-5 text-red-400" />
          <span className="text-lg font-bold">{BRAND.shortName}</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
            Superadmin
          </span>
          {/* Close button on mobile */}
          <button
            onClick={closeMobileSidebar}
            className="ml-auto text-gray-400 hover:text-gray-200 md:hidden"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={handleNavClick}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                }`
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Back to console */}
        <div className="p-3 border-t border-gray-800">
          <button
            onClick={() => { navigate('/'); handleNavClick(); }}
            className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Console</span>
          </button>
          {user && (
            <p className="text-xs text-gray-500 mt-2 px-3 truncate">{user.email}</p>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
        {/* Top bar */}
        <header className="h-16 bg-gray-900 border-b border-gray-800 flex items-center px-4 md:px-6 gap-4">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="text-gray-400 hover:text-gray-200 md:hidden"
            aria-label="Open sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="text-sm font-medium text-gray-400">Superadmin Panel</h1>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
