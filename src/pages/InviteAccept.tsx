import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@/constants/auth';

type InviteInfo = {
  email: string;
  role: string;
  invite_type?: 'workspace_access' | 'platform_access';
  workspace_name?: string | null;
  inviter_name: string;
  expires_at: string;
};

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading, logout } = useAuthStore();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  // Inline registration form state
  const [regForm, setRegForm] = useState({ first_name: '', last_name: '', password: '' });
  const [regError, setRegError] = useState('');
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regFallbackMessage, setRegFallbackMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadInvite() {
      if (!token) {
        setError('Invalid invite link');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get<{ invite: InviteInfo }>(`/api/invites/${token}`);
        if (!active) return;
        setInvite(res.invite);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load invite');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadInvite();
    return () => {
      active = false;
    };
  }, [token]);

  const redirectPath = token ? `/invite/${token}` : '/login';

  const handleAccept = useCallback(async () => {
    if (!token) return;
    setAcceptError(null);
    setAccepting(true);
    try {
      await apiClient.post(`/api/invites/${token}/accept`);
      setAccepted(true);
      setTimeout(() => navigate('/'), 600);
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : 'Failed to accept invite');
    } finally {
      setAccepting(false);
    }
  }, [token, navigate]);

  // Auto-accept for logged-in users with matching email
  useEffect(() => {
    if (
      !authLoading &&
      user &&
      invite &&
      !accepted &&
      !accepting &&
      !acceptError &&
      user.email.toLowerCase() === invite.email.toLowerCase()
    ) {
      handleAccept();
    }
  }, [authLoading, user, invite, accepted, accepting, acceptError, handleAccept]);

  // Inline registration submit
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite || !token) return;
    setRegError('');
    setRegSubmitting(true);
    try {
      const result = await apiClient.post<{ message: string; session_set?: boolean; redirect?: string }>(
        '/api/auth/register',
        {
          email: invite.email,
          password: regForm.password,
          first_name: regForm.first_name,
          last_name: regForm.last_name,
          redirect_path: `/invite/${token}`,
        }
      );
      if (result.session_set) {
        // Session cookie set — full page reload to pick up session
        window.location.href = result.redirect ?? '/';
        return;
      }
      // Fallback: no session was created (e.g. account already exists). Show helpful message.
      setRegFallbackMessage(result.message || 'Account created. Check your email to sign in.');
    } catch (err: unknown) {
      setRegError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setRegSubmitting(false);
    }
  };

  const isPlatformInvite = invite?.invite_type === 'platform_access';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8 md:p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Flash MDM</h1>
          <p className="text-gray-500 mt-2 text-sm md:text-base">
            {isPlatformInvite ? 'Platform Invitation' : 'Workspace Invitation'}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 md:p-8 space-y-4">
          {loading ? (
            <p className="text-sm text-gray-500">Loading invite…</p>
          ) : error ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900">Invite unavailable</h2>
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              <div className="text-sm">
                <Link to="/login" className="text-accent hover:underline">Go to sign in</Link>
              </div>
            </>
          ) : invite ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900">
                {user ? 'Accept invitation' : 'Join workspace'}
              </h2>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
                {invite.workspace_name && (
                  <p><span className="text-gray-500">Workspace:</span> <span className="font-medium text-gray-900">{invite.workspace_name}</span></p>
                )}
                <p><span className="text-gray-500">Invite type:</span> <span className="font-medium text-gray-900">
                  {isPlatformInvite ? 'Platform operator' : 'Workspace team'}
                </span></p>
                {!isPlatformInvite && (
                  <p><span className="text-gray-500">Role:</span> <span className="font-medium text-gray-900 capitalize">{invite.role}</span></p>
                )}
                <p><span className="text-gray-500">Email:</span> <span className="font-medium text-gray-900">{invite.email}</span></p>
                <p><span className="text-gray-500">Invited by:</span> <span className="font-medium text-gray-900">{invite.inviter_name}</span></p>
              </div>

              {accepted ? (
                <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  Invite accepted. Redirecting…
                </p>
              ) : user ? (
                <>
                  {authLoading ? (
                    <p className="text-sm text-gray-500">Checking your session…</p>
                  ) : user.email.toLowerCase() !== invite.email.toLowerCase() ? (
                    <>
                      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        You are signed in as <strong>{user.email}</strong>, but this invite is for <strong>{invite.email}</strong>.
                      </p>
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => logout()}
                          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Sign out
                        </button>
                        <a
                          href={`/login?redirect=${encodeURIComponent(redirectPath)}`}
                          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors"
                        >
                          Sign in as invited user
                        </a>
                      </div>
                    </>
                  ) : (
                    <>
                      {acceptError && (
                        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                          {acceptError}
                        </p>
                      )}
                      <p className="text-sm text-gray-500">
                        {accepting ? 'Accepting invite…' : 'Preparing to accept…'}
                      </p>
                    </>
                  )}
                </>
              ) : isPlatformInvite ? (
                <>
                  {/* Platform invites require workspace creation — redirect to full register page */}
                  <p className="text-sm text-gray-600">
                    Create an operator account with <strong>{invite.email}</strong>, create your workspace during signup, then return here to accept this platform invitation.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <a
                      href={`/login?redirect=${encodeURIComponent(redirectPath)}`}
                      className="rounded-lg bg-accent px-4 py-2 text-center text-sm font-medium text-white hover:bg-accent-light transition-colors"
                    >
                      Sign In
                    </a>
                    <a
                      href={`/register?redirect=${encodeURIComponent(redirectPath)}`}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-center text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Create Account
                    </a>
                  </div>
                </>
              ) : regFallbackMessage ? (
                <>
                  <p className="text-sm text-gray-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                    {regFallbackMessage}
                  </p>
                  <a
                    href={`/login?redirect=${encodeURIComponent(redirectPath)}`}
                    className="block w-full rounded-lg bg-accent px-4 py-2 text-center text-sm font-medium text-white hover:bg-accent-light transition-colors"
                  >
                    Sign in to accept invite
                  </a>
                </>
              ) : (
                <>
                  {/* Workspace invite — inline registration form */}
                  <p className="text-sm text-gray-600">
                    Create an account with <strong>{invite.email}</strong> to join this workspace.
                  </p>
                  {regError && (
                    <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{regError}</p>
                  )}
                  <form onSubmit={handleRegister} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">First name</label>
                        <input
                          type="text"
                          required
                          value={regForm.first_name}
                          onChange={(e) => setRegForm({ ...regForm, first_name: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Last name</label>
                        <input
                          type="text"
                          required
                          value={regForm.last_name}
                          onChange={(e) => setRegForm({ ...regForm, last_name: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                      <input
                        type="password"
                        required
                        minLength={MIN_PASSWORD_LENGTH}
                        maxLength={MAX_PASSWORD_LENGTH}
                        value={regForm.password}
                        onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                        placeholder={`Minimum ${MIN_PASSWORD_LENGTH} characters`}
                      />
                      <p className="mt-1 text-xs text-gray-500">Minimum {MIN_PASSWORD_LENGTH} characters</p>
                    </div>
                    <button
                      type="submit"
                      disabled={regSubmitting || regForm.password.length < MIN_PASSWORD_LENGTH}
                      className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
                    >
                      {regSubmitting ? 'Creating account…' : 'Create Account & Join'}
                    </button>
                  </form>
                  <p className="text-center text-sm text-gray-500">
                    Already have an account?{' '}
                    <a href={`/login?redirect=${encodeURIComponent(redirectPath)}`} className="text-accent hover:underline">
                      Sign in
                    </a>
                  </p>
                </>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
