import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/stores/auth';
import { useContextStore } from '@/stores/context';
import { useCreateEnvironment, useBindEnvironmentStep1 } from '@/api/queries/environments';
import { apiClient } from '@/api/client';
import { ExternalLink, Loader2, Check, AlertCircle } from 'lucide-react';

export default function EnvironmentSetup() {
  const navigate = useNavigate();
  const { user, fetchSession } = useAuthStore();
  const { fetchWorkspaces, fetchEnvironments } = useContextStore();
  const createEnvironment = useCreateEnvironment();
  const bindStep1 = useBindEnvironmentStep1();

  const [step, setStep] = useState<'name' | 'bind' | 'done'>('name');
  const [envName, setEnvName] = useState('');
  const [createdEnvId, setCreatedEnvId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ success?: string; error?: string }>({});
  const [initializing, setInitializing] = useState(true);

  // Get the user's workspace (they should have exactly one after signup link registration)
  const workspaceId = user?.workspace_id;

  const clearSetupFlag = useCallback(async () => {
    setFeedback({});
    try {
      await apiClient.post('/api/auth/session', { clear_environment_setup: true });
      await fetchSession();
      await fetchWorkspaces();
      navigate('/');
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to complete setup' });
    }
  }, [fetchSession, fetchWorkspaces, navigate]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      if (!workspaceId) {
        if (!cancelled) setInitializing(false);
        return;
      }
      try {
        const result = await apiClient.get<{
          environments: Array<{
            id: string;
            name: string;
            enterprise_name?: string | null;
            created_at?: string;
          }>;
        }>(`/api/environments/list?workspace_id=${workspaceId}`);
        if (cancelled) return;
        const environments = result.environments ?? [];
        if (environments.length === 0) {
          setInitializing(false);
          return;
        }

        const newestUnbound = [...environments]
          .filter((environment) => !environment.enterprise_name)
          .sort((a, b) => {
            const aTime = Date.parse(a.created_at ?? '') || 0;
            const bTime = Date.parse(b.created_at ?? '') || 0;
            return bTime - aTime;
          })[0];

        if (newestUnbound) {
          setCreatedEnvId(newestUnbound.id);
          setEnvName(newestUnbound.name);
          setStep('bind');
          setFeedback({ success: `Continuing setup for ${newestUnbound.name}.` });
          setInitializing(false);
          return;
        }

        await clearSetupFlag();
      } catch (err) {
        if (!cancelled) {
          setFeedback({ error: err instanceof Error ? err.message : 'Failed to load existing environments' });
          setInitializing(false);
        }
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, clearSetupFlag]);

  const handleCreateEnvironment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || !envName.trim()) return;

    setFeedback({});
    try {
      const result = await createEnvironment.mutateAsync({
        workspace_id: workspaceId,
        name: envName.trim(),
      });
      setCreatedEnvId(result.environment.id);
      await fetchEnvironments(workspaceId);
      setStep('bind');
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to create environment' });
    }
  };

  const handleBind = async () => {
    if (!createdEnvId) return;
    setFeedback({});
    try {
      const result = await bindStep1.mutateAsync({ environment_id: createdEnvId });
      if (result.signup_url) {
        window.location.href = result.signup_url;
      }
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to initiate enterprise binding' });
    }
  };

  const handleSkipBind = async () => {
    await clearSetupFlag();
  };

  const handleComplete = async () => {
    await clearSetupFlag();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8 md:p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Flash MDM</h1>
          <p className="text-gray-500 mt-2 text-sm md:text-base">Set up your environment</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 md:p-8">
          {initializing ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking setup state...
            </div>
          ) : (
            <>
          {/* Progress indicator */}
          <div className="flex items-center gap-2 mb-6">
            <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium ${step === 'name' ? 'bg-accent text-white' : 'bg-green-100 text-green-700'}`}>
              {step !== 'name' ? <Check className="w-4 h-4" /> : '1'}
            </div>
            <div className={`flex-1 h-0.5 ${step !== 'name' ? 'bg-green-300' : 'bg-gray-200'}`} />
            <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium ${step === 'bind' ? 'bg-accent text-white' : step === 'done' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
              {step === 'done' ? <Check className="w-4 h-4" /> : '2'}
            </div>
          </div>

          {step === 'name' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Create your environment</h2>
                <p className="text-sm text-gray-500 mt-1">
                  An environment represents a managed Android Enterprise. Give it a name to get started.
                </p>
              </div>

              <form onSubmit={handleCreateEnvironment} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Environment Name</label>
                  <input
                    type="text"
                    required
                    value={envName}
                    onChange={(e) => setEnvName(e.target.value)}
                    placeholder="e.g. Production, My Organisation..."
                    autoFocus
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                </div>

                {feedback.error && (
                  <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <AlertCircle className="h-4 w-4" />
                    {feedback.error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={createEnvironment.isPending || !envName.trim()}
                  className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
                >
                  {createEnvironment.isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </span>
                  ) : (
                    'Continue'
                  )}
                </button>
              </form>
            </div>
          )}

          {step === 'bind' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Bind an enterprise</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Connect your environment to an Android Enterprise to start managing devices.
                  You can also skip this and do it later from Settings.
                </p>
              </div>

              {feedback.error && (
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4" />
                  {feedback.error}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleBind}
                  disabled={bindStep1.isPending}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
                >
                  {bindStep1.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Starting bind...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="h-4 w-4" />
                      Bind Enterprise
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleSkipBind}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="space-y-4 text-center">
              <div className="flex items-center justify-center">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100">
                  <Check className="w-6 h-6 text-green-700" />
                </div>
              </div>
              <h2 className="text-lg font-semibold text-gray-900">Setup complete</h2>
              <p className="text-sm text-gray-500">
                Your environment is ready. You can now start managing devices.
              </p>
              <button
                type="button"
                onClick={handleComplete}
                className="rounded-lg bg-accent px-6 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors"
              >
                Go to Dashboard
              </button>
            </div>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
