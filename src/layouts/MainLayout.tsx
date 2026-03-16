import { Outlet, NavLink, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth';
import { useContextStore } from '@/stores/context';
import { useUiStore } from '@/stores/ui';
import { useFlashagentStore } from '@/stores/flashagent';
import { apiClient } from '@/api/client';
import { useFlashiSettings } from '@/api/queries/flashagent';
import { useEffect, useCallback, useState } from 'react';
import {
  LayoutDashboard, Smartphone, Shield, Package, Wifi, Key, Users, FolderTree,
  Settings, FileText, MapPin, Zap, CreditCard, BarChart3, ShieldAlert, LogOut, Menu, ChevronDown, X, Search, ShieldCheck
} from 'lucide-react';
import ContextSwitcher from '@/components/common/ContextSwitcher';
import GlobalSearch from '@/components/common/GlobalSearch';
import FlashiButton from '@/components/flashi/FlashiButton';
import FlashiPanel from '@/components/flashi/FlashiPanel';
import { BRAND } from '@/lib/brand';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/devices', icon: Smartphone, label: 'Devices' },
  { to: '/policies', icon: Shield, label: 'Policies' },
  { to: '/apps', icon: Package, label: 'Applications' },
  { to: '/networks', icon: Wifi, label: 'Networks' },
  { to: '/enrolment', icon: Key, label: 'Enrolment' },
  { to: '/groups', icon: FolderTree, label: 'Groups' },
  { to: '/users', icon: Users, label: 'Users' },
  { to: '/roles', icon: ShieldCheck, label: 'Roles' },
  { to: '/geofencing', icon: MapPin, label: 'Geofencing' },
  { to: '/audit', icon: FileText, label: 'Audit Log' },
  { to: '/workflows', icon: Zap, label: 'Workflows' },
  { to: '/licenses', icon: CreditCard, label: 'Licences' },
  { to: '/reports', icon: BarChart3, label: 'Reports' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function MainLayout() {
  const { user, logout, fetchSession } = useAuthStore();
  const { fetchWorkspaces, activeWorkspace } = useContextStore();
  const { sidebarOpen, toggleSidebar, setSidebarOpen } = useUiStore();
  const chatOpen = useFlashagentStore((s) => s.chatOpen);
  const navigate = useNavigate();

  // Flashi assistant feature check
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const { data: flashiSettings } = useFlashiSettings(activeEnvironment?.id);
  const flashiEnabled = flashiSettings?.effective_enabled ?? false;

  const { data: workspaceLicensingSettings } = useQuery<{
    workspace_id: string;
    settings: {
      effective_licensing_enabled: boolean;
    };
  }>({
    queryKey: ['license-settings', activeWorkspace?.id, activeEnvironment?.id],
    queryFn: () => {
      const params = new URLSearchParams({ workspace_id: activeWorkspace!.id });
      if (activeEnvironment?.id) params.set('environment_id', activeEnvironment.id);
      return apiClient.get(`/api/licenses/settings?${params.toString()}`);
    },
    enabled: Boolean(activeWorkspace?.id) && (
      // Workspace-scoped users can query immediately; scoped users need an active environment
      Boolean(user?.is_superadmin || activeWorkspace?.access_scope === 'workspace' || activeEnvironment?.id)
    ),
    staleTime: 60_000,
  });
  const licensingVisible = activeWorkspace?.id
    ? (workspaceLicensingSettings?.settings?.effective_licensing_enabled ?? true)
    : true;

  useEffect(() => {
    fetchSession();
    fetchWorkspaces();
  }, [fetchSession, fetchWorkspaces]);

  // Redirect to environment setup if the user needs it
  useEffect(() => {
    if (user?.needs_environment_setup) {
      navigate('/setup/environment');
    }
  }, [user, navigate]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Global search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [endingImpersonation, setEndingImpersonation] = useState(false);

  // Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen]);

  const closeMobileSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const handleNavClick = useCallback(() => {
    // Close sidebar on mobile when a nav link is clicked
    if (window.innerWidth < 768) {
      closeMobileSidebar();
    }
  }, [closeMobileSidebar]);

  const handleStopImpersonation = async () => {
    setEndingImpersonation(true);
    try {
      await apiClient.post('/api/superadmin/actions', { action: 'stop_impersonation' });
      await fetchSession();
      navigate('/superadmin/workspaces');
    } finally {
      setEndingImpersonation(false);
    }
  };

  const BrandMark = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex items-center ${compact ? 'justify-center' : 'gap-2.5'}`}>
      <img
        src="/favicon.svg"
        alt="Flash logo"
        className={compact ? 'h-7 w-7' : 'h-7 w-7 rounded-sm'}
      />
      {!compact && (
        <span className="text-lg font-semibold text-gray-900">
          {BRAND.shortName}
        </span>
      )}
    </div>
  );

  return (
    <div className="min-h-screen flex">
      {/* Mobile backdrop overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={closeMobileSidebar}
          data-testid="sidebar-backdrop"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col transition-all duration-200
          md:static md:translate-x-0 md:z-auto
          ${sidebarOpen ? 'md:w-64' : 'md:w-16'}
        `}
        data-testid="sidebar"
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-gray-200">
          <div className="md:hidden">
            <BrandMark />
          </div>
          {sidebarOpen ? (
            <div className="hidden md:block">
              <BrandMark />
            </div>
          ) : (
            <div className="mx-auto hidden md:block">
              <BrandMark compact />
            </div>
          )}
          {/* Close button on mobile */}
          <button
            onClick={closeMobileSidebar}
            className="ml-auto text-gray-500 hover:text-gray-700 md:hidden"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Context Switcher — always show on mobile, conditional on desktop */}
        <div className="p-3 border-b border-gray-200 md:hidden">
          <ContextSwitcher />
        </div>
        {sidebarOpen && (
          <div className="p-3 border-b border-gray-200 hidden md:block">
            <ContextSwitcher />
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems
            .filter((item) => item.to !== '/licenses' || licensingVisible)
            .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={handleNavClick}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {/* Always show label on mobile, conditional on desktop */}
              <span className="md:hidden">{item.label}</span>
              {sidebarOpen && <span className="hidden md:inline">{item.label}</span>}
            </NavLink>
            ))}
        </nav>

        {/* Superadmin link */}
        {user?.is_superadmin && (
          <div className="px-2 pb-1">
            <NavLink
              to="/superadmin"
              onClick={handleNavClick}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-red-50 text-red-700'
                    : 'text-red-600 hover:bg-red-50 hover:text-red-700'
                }`
              }
            >
              <ShieldAlert className="w-5 h-5 flex-shrink-0" />
              <span className="md:hidden">Superadmin</span>
              {sidebarOpen && <span className="hidden md:inline">Superadmin</span>}
            </NavLink>
          </div>
        )}

        {/* User section */}
        <div className="p-3 border-t border-gray-200">
          {/* Always show on mobile, conditional on desktop */}
          {user && (
            <div className="flex items-center gap-2 mb-2 px-3 md:hidden">
              <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-sm font-medium text-gray-600">
                {user.first_name?.[0] ?? user.email[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user.first_name ? `${user.first_name} ${user.last_name ?? ''}`.trim() : user.email}
                </p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
              </div>
            </div>
          )}
          {sidebarOpen && user && (
            <div className="hidden md:flex items-center gap-2 mb-2 px-3">
              <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-sm font-medium text-gray-600">
                {user.first_name?.[0] ?? user.email[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user.first_name ? `${user.first_name} ${user.last_name ?? ''}`.trim() : user.email}
                </p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="md:hidden">Sign out</span>
            {sidebarOpen && <span className="hidden md:inline">Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 md:px-6 gap-4">
          <button onClick={toggleSidebar} className="text-gray-500 hover:text-gray-700" aria-label="Toggle sidebar">
            <Menu className="w-5 h-5" />
          </button>

          {/* Global search trigger */}
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors ml-auto"
            data-testid="global-search-trigger"
          >
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">Search...</span>
            <kbd className="hidden sm:inline-flex items-center rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-mono text-gray-400">
              {navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}K
            </kbd>
          </button>
        </header>

        {/* Global search modal */}
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        {user?.impersonation?.active && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 md:px-6">
            <div className="flex flex-col gap-2 text-sm text-amber-900 md:flex-row md:items-center md:justify-between">
              <div>
                <span className="font-semibold">Impersonation active.</span>{' '}
                You are acting as {user.email}
                {user.impersonation.by_email ? ` (started by ${user.impersonation.by_email})` : ''}.
                {' '}Mode: <span className="font-medium">{user.impersonation.mode === 'read_only' ? 'read-only' : 'full'}</span>.
                {user.impersonation.support_ticket_ref ? ` Ticket: ${user.impersonation.support_ticket_ref}.` : ''}
                {user.impersonation.support_reason ? ` Reason: ${user.impersonation.support_reason}` : ''}
              </div>
              <button
                onClick={handleStopImpersonation}
                disabled={endingImpersonation}
                className="inline-flex items-center justify-center rounded-md border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                {endingImpersonation ? 'Returning...' : 'Return to Superadmin'}
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Flashi assistant */}
      {flashiEnabled && <FlashiButton />}
      {flashiEnabled && chatOpen && <FlashiPanel />}
    </div>
  );
}
