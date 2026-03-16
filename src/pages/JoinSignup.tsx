import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import type { ResolvedSignupLink } from '@/api/queries/signupLinks';
import { Loader2 } from 'lucide-react';

export default function JoinSignup() {
  const { token } = useParams<{ token: string }>();
  const { user, isLoading: authLoading } = useAuthStore();

  const [linkInfo, setLinkInfo] = useState<ResolvedSignupLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;

    async function resolve() {
      if (!token) {
        setError('Invalid signup link');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.get<ResolvedSignupLink>(
          `/api/signup-links/resolve/${encodeURIComponent(token)}`
        );
        if (!active) return;
        setLinkInfo(res);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'This signup link is invalid or has been disabled');
      } finally {
        if (active) setLoading(false);
      }
    }

    resolve();
    return () => { active = false; };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiClient.post('/api/auth/register', {
        email: email.trim().toLowerCase(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        signup_link_token: token,
      });
      setSuccess(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8 md:p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Flash MDM</h1>
          <p className="text-gray-500 mt-2 text-sm md:text-base">
            {loading ? 'Loading...' : linkInfo ? 'Sign up' : 'Signup Link'}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 md:p-8 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading signup link...</span>
            </div>
          ) : error ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900">Link unavailable</h2>
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              <div className="text-sm">
                <Link to="/login" className="text-accent hover:underline">Go to sign in</Link>
              </div>
            </>
          ) : linkInfo && !authLoading && user ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900">Already signed in</h2>
              <p className="text-sm text-gray-600">
                You are already signed in as <strong>{user.email}</strong>.
              </p>
              <Link
                to="/"
                className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors"
              >
                Go to Dashboard
              </Link>
            </>
          ) : linkInfo && success ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900">Check your email</h2>
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                We sent you a magic sign-in link.
              </p>
            </>
          ) : linkInfo ? (
            <>
              <h2 className="text-lg font-semibold text-gray-900">Create your account</h2>

              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>
                {submitError && (
                  <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {submitError}
                  </p>
                )}

                  <button
                    type="submit"
                    disabled={submitting || !firstName.trim() || !lastName.trim() || !email.trim()}
                    className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
                  >
                  {submitting ? 'Sending magic link...' : 'Continue'}
                </button>
              </form>

              <p className="text-sm text-center text-gray-500">
                Already have an account?{' '}
                <Link to="/login" className="text-accent hover:underline">Sign in</Link>
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
