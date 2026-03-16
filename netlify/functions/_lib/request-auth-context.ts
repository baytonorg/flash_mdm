import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditRequestAuthContext {
  authType: 'session' | 'api_key';
  user: {
    id: string;
    email: string;
  };
  apiKey?: {
    id: string;
    name: string;
    scope_type: 'workspace' | 'environment';
    scope_id: string;
    workspace_id: string;
    environment_id: string | null;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    created_by_user_id: string;
    created_by_email?: string | null;
    created_by_name?: string | null;
  };
}

const requestAuthContext = new AsyncLocalStorage<AuditRequestAuthContext>();

export function setCurrentAuditAuthContext(ctx: AuditRequestAuthContext): void {
  requestAuthContext.enterWith(ctx);
}

export function getCurrentAuditAuthContext(): AuditRequestAuthContext | undefined {
  return requestAuthContext.getStore();
}

export async function runWithAuditAuthContext<T>(
  ctx: AuditRequestAuthContext,
  fn: () => Promise<T> | T
): Promise<T> {
  return requestAuthContext.run(ctx, fn);
}

