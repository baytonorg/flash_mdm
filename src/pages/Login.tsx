import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth';
import { useNavigate, Link, useSearchParams } from 'react-router';
import { apiClient } from '@/api/client';
import { sanitizeInAppRedirect } from '@/lib/redirect';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [mode, setMode] = useState<'choose' | 'password' | 'magic-link-sent' | 'totp'>('choose');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, loginWithMagicLink, completeMagicLinkMfa, error } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const redirectTo = sanitizeInAppRedirect(searchParams.get('redirect'));
  const [mfaPendingToken] = useState(() => searchParams.get('mfa_pending'));
  const authErrorCode = searchParams.get('auth_error');
  const [inviteOnlyRegistration, setInviteOnlyRegistration] = useState(false);
  const authErrorMessage = authErrorCode === 'expired_or_used_magic_link'
    ? 'That sign-in link is invalid or has already been used. Request a new magic link to continue.'
    : authErrorCode === 'invalid_magic_link'
      ? 'That sign-in link is invalid. Request a new magic link to continue.'
      : null;

  useEffect(() => {
    if (mfaPendingToken) {
      setMode('totp');
    }
  }, [mfaPendingToken]);

  useEffect(() => {
    if (!mfaPendingToken || !searchParams.has('mfa_pending')) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('mfa_pending');
    setSearchParams(nextParams, { replace: true });
  }, [mfaPendingToken, searchParams, setSearchParams]);

  useEffect(() => {
    let active = true;
    apiClient
      .get<{ invite_only_registration: boolean }>('/api/auth/config')
      .then((config) => {
        if (active) setInviteOnlyRegistration(config.invite_only_registration);
      })
      .catch(() => {
        // Keep login usable even if the public auth config endpoint fails.
      });
    return () => {
      active = false;
    };
  }, []);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await loginWithMagicLink(email, redirectTo);
      setMode('magic-link-sent');
    } catch {
      // error handled in store
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await login(email, password, totpCode || undefined);
      navigate(redirectTo);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('TOTP')) {
        setMode('totp');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (mfaPendingToken) {
        await completeMagicLinkMfa(mfaPendingToken, totpCode);
      } else {
        await login(email, password, totpCode || undefined);
      }
      navigate(redirectTo);
    } catch {
      // error handled in store
    } finally {
      setIsSubmitting(false);
    }
  };

  if (mode === 'magic-link-sent') {
    return (
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-4">Check your email</h2>
        <p className="text-gray-600 mb-6">We've sent a sign-in link to <strong>{email}</strong></p>
        <button onClick={() => setMode('choose')} className="text-sm text-accent hover:underline">Use a different method</button>
      </div>
    );
  }

  if (mode === 'totp') {
    return (
      <form onSubmit={handleTotpSubmit} className="space-y-4">
        <h2 className="text-xl font-semibold">Two-factor authentication</h2>
        <p className="text-gray-600 text-sm">
          {mfaPendingToken
            ? 'Complete sign-in from your magic link by entering your authenticator code.'
            : 'Enter the code from your authenticator app.'}
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={totpCode}
          onChange={(e) => setTotpCode(e.target.value)}
          placeholder="6-digit code"
          className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
          maxLength={6}
          autoFocus
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white py-2 rounded-lg font-medium hover:bg-primary-light transition-colors disabled:opacity-50">
          {isSubmitting ? 'Verifying...' : 'Verify'}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Sign in</h2>
      {authErrorMessage && <p className="text-sm text-danger bg-red-50 px-3 py-2 rounded-lg">{authErrorMessage}</p>}
      {error && <p className="text-sm text-danger bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      {mode === 'choose' && (
        <form onSubmit={handleMagicLink} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              pattern="^[^\s@]+@[^\s@]+\.[^\s@]{2,}$"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              autoFocus
            />
          </div>
          <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white py-2 rounded-lg font-medium hover:bg-primary-light transition-colors disabled:opacity-50">
            {isSubmitting ? 'Sending...' : 'Send magic link'}
          </button>
          <div className="text-center">
            <button type="button" onClick={() => setMode('password')} className="text-sm text-gray-500 hover:text-gray-700">
              Sign in with password instead
            </button>
          </div>
        </form>
      )}

      {mode === 'password' && (
        <form onSubmit={handlePasswordLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </div>
          <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white py-2 rounded-lg font-medium hover:bg-primary-light transition-colors disabled:opacity-50">
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
          <div className="text-center">
            <Link to="/reset-password" className="text-sm text-accent hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="text-center">
            <button type="button" onClick={() => setMode('choose')} className="text-sm text-gray-500 hover:text-gray-700">
              Use magic link instead
            </button>
          </div>
        </form>
      )}

      <p className="text-center text-sm text-gray-500">
        {inviteOnlyRegistration ? (
          'Registration is invite-only. Ask a workspace admin for an invitation.'
        ) : (
          <>Don't have an account? <Link to={`/register?redirect=${encodeURIComponent(redirectTo)}`} className="text-accent hover:underline">Register</Link></>
        )}
      </p>
    </div>
  );
}
