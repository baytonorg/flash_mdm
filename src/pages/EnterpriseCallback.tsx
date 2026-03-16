import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { apiClient } from '@/api/client';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

/**
 * Enterprise binding callback page.
 * Google redirects here after the admin completes the enterprise signup.
 * URL: /settings/enterprise/callback?environment_id=...&enterpriseToken=...
 *
 * This page calls Step 2 of the bind flow (POST /api/environments/bind)
 * with the enterprise_token, then redirects to Settings.
 */
export default function EnterpriseCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing enterprise binding...');
  const [enterpriseName, setEnterpriseName] = useState<string | null>(null);

  useEffect(() => {
    const environmentId = searchParams.get('environment_id');
    const enterpriseToken = searchParams.get('enterpriseToken');

    if (!environmentId || !enterpriseToken) {
      setStatus('error');
      setMessage('Missing environment_id or enterpriseToken in callback URL.');
      return;
    }

    (async () => {
      try {
        const result = await apiClient.post<{
          enterprise: { name: string; display_name: string };
        }>('/api/environments/bind', {
          environment_id: environmentId,
          enterprise_token: enterpriseToken,
        });

        setEnterpriseName(result.enterprise.display_name || result.enterprise.name);
        setStatus('success');
        setMessage('Enterprise bound successfully!');

        // Auto-redirect to settings after a short delay
        setTimeout(() => {
          navigate('/settings', { replace: true });
        }, 3000);
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to complete enterprise binding.');
      }
    })();
  }, [searchParams, navigate]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="bg-white rounded-xl border border-gray-200 p-8 max-w-md w-full mx-4 text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="h-12 w-12 text-accent animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Binding Enterprise</h2>
            <p className="text-sm text-gray-500">{message}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Enterprise Bound!</h2>
            {enterpriseName && (
              <p className="text-sm text-gray-700 mb-2 font-medium">{enterpriseName}</p>
            )}
            <p className="text-sm text-gray-500">{message}</p>
            <p className="text-xs text-gray-400 mt-4">Redirecting to Settings...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Binding Failed</h2>
            <p className="text-sm text-red-600 mb-4">{message}</p>
            <button
              onClick={() => navigate('/settings', { replace: true })}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors"
            >
              Go to Settings
            </button>
          </>
        )}
      </div>
    </div>
  );
}
