import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { apiClient } from '@/api/client';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@/constants/auth';
import { redirectBrowserToInApp, sanitizeInAppRedirect } from '@/lib/redirect';

type InviteType = 'workspace_access' | 'platform_access';

export default function Register() {
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', password: '', workspace_name: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [inviteOnlyRegistration, setInviteOnlyRegistration] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [inviteType, setInviteType] = useState<InviteType>('workspace_access');
  const [searchParams] = useSearchParams();
  const redirectTo = sanitizeInAppRedirect(searchParams.get('redirect'));
  const isInviteOnboarding = redirectTo.startsWith('/invite/');
  const inviteToken = isInviteOnboarding ? redirectTo.split('/invite/')[1]?.split('/')[0] ?? '' : '';
  const isWorkspaceInviteOnboarding = isInviteOnboarding && inviteType === 'workspace_access';

  useEffect(() => {
    let active = true;
    apiClient
      .get<{ invite_only_registration: boolean }>('/api/auth/config')
      .then((config) => {
        if (!active) return;
        setInviteOnlyRegistration(config.invite_only_registration);
        setConfigLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setConfigLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!isInviteOnboarding || !inviteToken) {
      setInviteType('workspace_access');
      return;
    }
    apiClient
      .get<{ invite: { invite_type?: InviteType } }>(`/api/invites/${inviteToken}`)
      .then((res) => {
        if (!active) return;
        setInviteType(res.invite.invite_type === 'platform_access' ? 'platform_access' : 'workspace_access');
      })
      .catch(() => {
        if (!active) return;
        setInviteType('workspace_access');
      });
    return () => {
      active = false;
    };
  }, [isInviteOnboarding, inviteToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const result = await apiClient.post<{ message: string; session_set?: boolean; redirect?: string }>(
        '/api/auth/register',
        { ...form, redirect_path: redirectTo }
      );
      if (result.session_set) {
        // Session cookie was set by the response — full page reload to pick it up
        redirectBrowserToInApp(result.redirect, '/');
        return;
      }
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-4">Check your email</h2>
        <p className="text-gray-600">We've sent a sign-in link to <strong>{form.email}</strong></p>
      </div>
    );
  }

  if (configLoaded && inviteOnlyRegistration && !isInviteOnboarding) {
    return (
      <div className="space-y-6 text-center">
        <h2 className="text-xl font-semibold">Registration is invite-only</h2>
        <p className="text-gray-600">
          Self-serve registration is disabled. Ask a workspace admin for an invitation, then sign in.
        </p>
        <p className="text-sm text-gray-500">
          Already have an account? <Link to="/login" className="text-accent hover:underline">Sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Create account</h2>
      {isInviteOnboarding && (
        <p className="text-sm text-gray-600">
          {isWorkspaceInviteOnboarding
            ? 'Create an account to join the workspace. You\'ll be signed in automatically.'
            : 'Create an operator account and workspace, then use the magic link email to return and accept your platform invitation.'}
        </p>
      )}
      {error && <p className="text-sm text-danger bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
            <input type="text" required value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
            <input type="text" required value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            type="password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent" />
          <p className="mt-1 text-xs text-gray-500">Minimum {MIN_PASSWORD_LENGTH} characters</p>
        </div>
        {!isWorkspaceInviteOnboarding && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Workspace name</label>
            <input type="text" required value={form.workspace_name} onChange={(e) => setForm({ ...form, workspace_name: e.target.value })}
              placeholder="My Organisation"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent" />
          </div>
        )}
        <button
          type="submit"
          disabled={isSubmitting || form.password.length < MIN_PASSWORD_LENGTH}
          className="w-full bg-primary text-white py-2 rounded-lg font-medium hover:bg-primary-light transition-colors disabled:opacity-50"
        >
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>
      <p className="text-center text-sm text-gray-500">
        Already have an account? <Link to="/login" className="text-accent hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
