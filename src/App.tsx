import React, { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { useAuthStore } from '@/stores/auth';
import MainLayout from '@/layouts/MainLayout';
import GuestLayout from '@/layouts/GuestLayout';
import SuperadminLayout from '@/layouts/SuperadminLayout';
import ErrorBoundary from '@/components/common/ErrorBoundary';
import NotFound from '@/components/common/NotFound';

// Lazy-loaded page components for code-splitting
const Dashboard = React.lazy(() => import('@/pages/Dashboard'));
const Devices = React.lazy(() => import('@/pages/Devices'));
const DeviceDetail = React.lazy(() => import('@/pages/DeviceDetail'));
const Policies = React.lazy(() => import('@/pages/Policies'));
const PolicyEditor = React.lazy(() => import('@/pages/PolicyEditor'));
const EnrollmentTokens = React.lazy(() => import('@/pages/EnrollmentTokens'));
const Groups = React.lazy(() => import('@/pages/Groups'));
const Users = React.lazy(() => import('@/pages/Users'));
const Roles = React.lazy(() => import('@/pages/Roles'));
const Settings = React.lazy(() => import('@/pages/Settings'));
const PolicyComponents = React.lazy(() => import('@/pages/PolicyComponents'));
const Applications = React.lazy(() => import('@/pages/Applications'));
const Networks = React.lazy(() => import('@/pages/Networks'));
const AuditLog = React.lazy(() => import('@/pages/AuditLog'));
const Workflows = React.lazy(() => import('@/pages/Workflows'));
const WorkflowBuilder = React.lazy(() => import('@/pages/WorkflowBuilder'));
const Geofencing = React.lazy(() => import('@/pages/Geofencing'));
const Licenses = React.lazy(() => import('@/pages/Licenses'));
const Reports = React.lazy(() => import('@/pages/Reports'));
const Login = React.lazy(() => import('@/pages/Login'));
const Register = React.lazy(() => import('@/pages/Register'));
const ResetPassword = React.lazy(() => import('@/pages/ResetPassword'));
const InviteAccept = React.lazy(() => import('@/pages/InviteAccept'));
const JoinSignup = React.lazy(() => import('@/pages/JoinSignup'));
const EnvironmentSetup = React.lazy(() => import('@/pages/EnvironmentSetup'));
const EnterpriseCallback = React.lazy(() => import('@/pages/EnterpriseCallback'));
const SigninEnroll = React.lazy(() => import('@/pages/SigninEnroll'));

// Named exports need the .then(m => ({ default: m.X })) pattern
const SuperadminDashboard = React.lazy(() => import('@/pages/Superadmin').then(m => ({ default: m.SuperadminDashboard })));
const SuperadminWorkspaces = React.lazy(() => import('@/pages/Superadmin').then(m => ({ default: m.SuperadminWorkspaces })));
const SuperadminUsers = React.lazy(() => import('@/pages/Superadmin').then(m => ({ default: m.SuperadminUsers })));
const SuperadminStats = React.lazy(() => import('@/pages/Superadmin').then(m => ({ default: m.SuperadminStats })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();
  if (isLoading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin h-8 w-8 border-2 border-accent border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();
  if (isLoading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin h-8 w-8 border-2 border-accent border-t-transparent rounded-full" /></div>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  const fetchSession = useAuthStore((s) => s.fetchSession);
  useEffect(() => { fetchSession(); }, [fetchSession]);

  return (
    <ErrorBoundary>
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="animate-spin h-8 w-8 border-2 border-accent border-t-transparent rounded-full" /></div>}>
    <Routes>
      {/* Guest routes */}
      <Route element={<GuestRoute><GuestLayout /></GuestRoute>}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      {/* Public password reset (must be reachable before/after auth) */}
      <Route element={<GuestLayout />}>
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>

      {/* Invite acceptance (must be reachable before/after auth) */}
      <Route path="/invite/:token" element={<InviteAccept />} />

      {/* Public join signup (must be reachable before/after auth) */}
      <Route path="/join/w/:token" element={<JoinSignup />} />
      <Route path="/join/e/:token" element={<JoinSignup />} />

      {/* Public sign-in enrollment (rendered in Chrome Custom Tab on device) */}
      <Route path="/signin/enroll" element={<SigninEnroll />} />

      {/* Post-login environment setup wizard */}
      <Route path="/setup/environment" element={<ProtectedRoute><EnvironmentSetup /></ProtectedRoute>} />

      {/* Protected routes */}
      <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="/devices" element={<Devices />} />
        <Route path="/devices/:id" element={<DeviceDetail />} />
        <Route path="/policies" element={<Policies />} />
        <Route path="/policies/new" element={<PolicyEditor />} />
        <Route path="/policies/:id" element={<PolicyEditor />} />
        <Route path="/policies/components" element={<PolicyComponents />} />
        <Route path="/apps" element={<Applications />} />
        <Route path="/networks" element={<Networks />} />
        <Route path="/enrolment" element={<EnrollmentTokens />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/users" element={<Users />} />
        <Route path="/roles" element={<Roles />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="/workflows" element={<Workflows />} />
        <Route path="/workflows/new" element={<WorkflowBuilder />} />
        <Route path="/workflows/:id" element={<WorkflowBuilder />} />
        <Route path="/geofencing" element={<Geofencing />} />
        <Route path="/licenses" element={<Licenses />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings/enterprise/callback" element={<EnterpriseCallback />} />
      </Route>

      {/* Superadmin routes */}
      <Route element={<ProtectedRoute><SuperadminLayout /></ProtectedRoute>}>
        <Route path="/superadmin" element={<SuperadminDashboard />} />
        <Route path="/superadmin/workspaces" element={<SuperadminWorkspaces />} />
        <Route path="/superadmin/users" element={<SuperadminUsers />} />
        <Route path="/superadmin/stats" element={<SuperadminStats />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
