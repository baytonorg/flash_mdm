import { queryClient } from '@/lib/queryClient';
import { useContextStore } from '@/stores/context';
import { useUiStore } from '@/stores/ui';
import { useFlashagentStore } from '@/stores/flashagent';

const FLASH_CONTEXT_STORAGE_KEY = 'flash_context';

/**
 * Resets all non-auth client session state: context, UI, Flashagent stores,
 * persisted flash_context, and the TanStack Query cache.
 *
 * Auth store state is intentionally NOT reset here to avoid a circular
 * dependency (auth.ts imports this module). The auth store is responsible
 * for clearing its own state before/after calling this function.
 */
export function resetClientSessionState(): void {
  useContextStore.getState().reset();
  useUiStore.getState().reset();
  useFlashagentStore.getState().reset();

  try {
    localStorage.removeItem(FLASH_CONTEXT_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }

  queryClient.clear();
}
