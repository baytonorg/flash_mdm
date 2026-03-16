import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { Mail, ShieldCheck, Loader2, AlertCircle, Smartphone } from 'lucide-react';

/**
 * Public page rendered in Chrome Custom Tab on the device when a user adds
 * their work Google account and Android Enterprise triggers sign-in URL enrollment.
 *
 * Flow: Email input → Verification code → Redirect to enrollment
 */
type Stage = 'email' | 'code' | 'redirecting' | 'error';

export default function SigninEnroll() {
  const [searchParams] = useSearchParams();
  const provisioningInfo = searchParams.get('provisioningInfo') ?? undefined;

  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const sendCode = useCallback(async () => {
    if (!email.trim()) return;
    setSending(true);
    setError('');

    try {
      const res = await fetch('/api/signin/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send-code',
          email: email.trim(),
          provisioning_info: provisioningInfo,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send verification code.');
        return;
      }

      setStage('code');
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSending(false);
    }
  }, [email, provisioningInfo]);

  const verifyCode = useCallback(async () => {
    if (!code.trim()) return;
    setVerifying(true);
    setError('');

    try {
      const res = await fetch('/api/signin/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'verify',
          email: email.trim(),
          code: code.trim(),
          provisioning_info: provisioningInfo,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Verification failed.');
        setVerifying(false);
        return;
      }

      if (data.redirect_url) {
        setStage('redirecting');
        // Brief delay so the user sees the "Setting up..." message
        setTimeout(() => {
          window.location.href = data.redirect_url;
        }, 1500);
      } else {
        setError('Enrolment setup failed. Please try again.');
        setVerifying(false);
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
      setVerifying(false);
    }
  }, [email, code, provisioningInfo]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-900 mb-4">
            <Smartphone className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Work Profile Setup</h1>
          <p className="text-sm text-gray-500 mt-1">
            Verify your identity to set up your managed work profile
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 mb-4 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Stage: Email input */}
          {stage === 'email' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Work email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendCode()}
                  placeholder="you@company.com"
                  autoFocus
                  autoComplete="email"
                  className="w-full rounded-lg border border-gray-300 py-2.5 pl-10 pr-3 text-sm
                    focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none
                    placeholder:text-gray-400"
                />
              </div>
              <button
                onClick={sendCode}
                disabled={sending || !email.trim()}
                className="mt-4 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white
                  hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed
                  flex items-center justify-center gap-2 transition-colors"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending code...
                  </>
                ) : (
                  'Continue'
                )}
              </button>
            </div>
          )}

          {/* Stage: Verification code */}
          {stage === 'code' && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="h-5 w-5 text-green-600" />
                <p className="text-sm text-gray-700">
                  We sent a code to <strong>{email}</strong>
                </p>
              </div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Verification code
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && verifyCode()}
                placeholder="000000"
                autoFocus
                autoComplete="one-time-code"
                className="w-full rounded-lg border border-gray-300 py-2.5 px-3 text-sm text-center
                  tracking-[0.3em] font-mono text-lg
                  focus:border-gray-900 focus:ring-1 focus:ring-gray-900 outline-none
                  placeholder:text-gray-400 placeholder:tracking-[0.3em]"
              />
              <button
                onClick={verifyCode}
                disabled={verifying || code.length < 6}
                className="mt-4 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white
                  hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed
                  flex items-center justify-center gap-2 transition-colors"
              >
                {verifying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify & Set Up'
                )}
              </button>
              <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                <button
                  onClick={() => {
                    setCode('');
                    setError('');
                    setStage('email');
                  }}
                  className="hover:text-gray-700 transition-colors"
                >
                  Change email
                </button>
                <button
                  onClick={() => {
                    setCode('');
                    setError('');
                    sendCode();
                  }}
                  className="hover:text-gray-700 transition-colors"
                >
                  Resend code
                </button>
              </div>
            </div>
          )}

          {/* Stage: Redirecting */}
          {stage === 'redirecting' && (
            <div className="text-center py-4">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900">Setting up your work profile...</p>
              <p className="text-xs text-gray-500 mt-1">You'll be redirected shortly</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          Your organisation manages this enrolment process.
          <br />
          Contact your IT administrator if you need help.
        </p>
      </div>
    </div>
  );
}
