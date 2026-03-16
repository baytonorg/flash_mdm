import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { apiClient } from '@/api/client';
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@/constants/auth';

type PasswordResetCompleteResponse = {
  message?: string;
  needs_mfa?: boolean;
  mfa_pending_token?: string;
};

function getApiErrorData(err: unknown): Record<string, unknown> | null {
  if (!err || typeof err !== 'object') return null;
  if (!('data' in err)) return null;
  const data = (err as { data?: unknown }).data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

function getApiErrorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  if (!('status' in err)) return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const resetToken = searchParams.get('token')?.trim() ?? '';

  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [mfaPendingToken, setMfaPendingToken] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const mode: 'request' | 'reset' | 'mfa' = mfaPendingToken
    ? 'mfa'
    : resetToken
      ? 'reset'
      : 'request';

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setIsSubmitting(true);
    try {
      const result = await apiClient.post<{ message: string }>('/api/auth/password-reset-start', { email });
      setSuccessMessage(result.message || 'If an account exists, a password reset link has been sent.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to request password reset');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    if (!resetToken) {
      setError('Reset token is missing');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await apiClient.post<PasswordResetCompleteResponse>('/api/auth/password-reset-complete', {
        token: resetToken,
        new_password: newPassword,
      });
      setSuccessMessage(result.message || 'Password reset successful. Please sign in again.');
    } catch (err: unknown) {
      const status = getApiErrorStatus(err);
      const data = getApiErrorData(err);
      const pendingToken =
        status === 401 &&
        data?.needs_mfa === true &&
        typeof data.mfa_pending_token === 'string'
          ? data.mfa_pending_token
          : null;

      if (pendingToken) {
        setMfaPendingToken(pendingToken);
        setTotpCode('');
        return;
      }

      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    if (!mfaPendingToken) return;

    setIsSubmitting(true);
    try {
      const result = await apiClient.post<{ message?: string }>('/api/auth/magic-link-complete', {
        token: mfaPendingToken,
        totp_code: totpCode.trim(),
      });
      setSuccessMessage(result.message || 'Password reset successful. Please sign in again.');
      setMfaPendingToken(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'MFA verification failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (mode === 'mfa') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Verify Reset</h2>
          <p className="text-sm text-gray-600 mt-1">
            Enter your authenticator code to finish resetting your password.
          </p>
        </div>

        {successMessage && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            {successMessage}
          </div>
        )}
        {error && <p className="text-sm text-danger bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        {!successMessage && (
          <form onSubmit={handleMfaSubmit} className="space-y-4">
            <div>
              <label htmlFor="reset-mfa-code" className="block text-sm font-medium text-gray-700 mb-1">Authenticator code</label>
              <input
                id="reset-mfa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="6-digit code"
                maxLength={12}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting || !totpCode.trim()}
              className="w-full bg-primary text-white py-2 rounded-lg font-medium hover:bg-primary-light transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Verifying...' : 'Verify and reset password'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-gray-500">
          Back to <Link to="/login" className="text-accent hover:underline">Sign in</Link>
        </p>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Choose a new password</h2>
          <p className="text-sm text-gray-600 mt-1">
            Enter a new password for your account.
          </p>
        </div>

        {successMessage && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            {successMessage}
          </div>
        )}
        {error && <p className="text-sm text-danger bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        {!successMessage && (
          <form onSubmit={handleCompleteReset} className="space-y-4">
            <div>
              <label htmlFor="reset-new-password" className="block text-sm font-medium text-gray-700 mb-1">New password</label>
              <input
                id="reset-new-password"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="reset-confirm-password" className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
              <input
                id="reset-confirm-password"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                maxLength={MAX_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              />
            </div>
            <p className="text-xs text-gray-500">Minimum {MIN_PASSWORD_LENGTH} characters</p>
            <button
              type="submit"
              disabled={isSubmitting || newPassword.length < MIN_PASSWORD_LENGTH || confirmPassword.length < MIN_PASSWORD_LENGTH}
              className="w-full bg-primary text-white py-2 rounded-lg font-medium hover:bg-primary-light transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Resetting...' : 'Reset password'}
            </button>
          </form>
        )}

        <p className="text-center text-sm text-gray-500">
          Back to <Link to="/login" className="text-accent hover:underline">Sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Reset your password</h2>
        <p className="text-sm text-gray-600 mt-1">
          Enter your email address and we&apos;ll send you a reset link.
        </p>
      </div>

      {successMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {successMessage}
        </div>
      )}
      {error && <p className="text-sm text-danger bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      {!successMessage && (
        <form onSubmit={handleRequestReset} className="space-y-4">
          <div>
            <label htmlFor="reset-request-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              id="reset-request-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting || !email.trim()}
            className="w-full bg-primary text-white py-2 rounded-lg font-medium hover:bg-primary-light transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Sending...' : 'Send reset link'}
          </button>
        </form>
      )}

      <p className="text-center text-sm text-gray-500">
        Remembered it? <Link to="/login" className="text-accent hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
