import { shouldTriggerBackgroundFunction } from './runtime.js';

export async function wakePolicyReconciliation() {
  if(!shouldTriggerBackgroundFunction())return;
  const origin=process.env.URL||process.env.DEPLOY_PRIME_URL;
  const secret=process.env.INTERNAL_FUNCTION_SECRET;
  if(!origin||!secret)return;
  try {
    const response=await fetch(new URL('/.netlify/functions/sync-process-background',origin),{method:'POST',headers:{'x-internal-secret':secret}});
    if(!response.ok)console.warn('Policy reconciliation remains queued; background wake was rejected');
  } catch {console.warn('Policy reconciliation remains queued; background wake failed');}
}
