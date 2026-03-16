import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useContextStore } from '@/stores/context';

/**
 * Redirects to `fallbackPath` when the active environment no longer matches
 * the environment of the currently viewed record. This handles the case where
 * a user switches environments while on a detail page (device, policy, workflow)
 * and the record doesn't belong to the new environment.
 */
export function useEnvironmentGuard(
  recordEnvironmentId: string | undefined | null,
  fallbackPath: string,
) {
  const activeEnvironmentId = useContextStore((s) => s.activeEnvironment?.id);
  const navigate = useNavigate();

  useEffect(() => {
    if (!activeEnvironmentId || !recordEnvironmentId) return;
    if (recordEnvironmentId !== activeEnvironmentId) {
      navigate(fallbackPath, { replace: true });
    }
  }, [activeEnvironmentId, recordEnvironmentId, fallbackPath, navigate]);
}
