export function isVpsRuntime(): boolean {
  return process.env.FLASH_RUNTIME?.toLowerCase() === 'vps';
}

export function internalFunctionUrl(request: Request, functionName: string): string {
  const configuredOrigin = process.env.FLASH_INTERNAL_ORIGIN?.trim();
  const origin = configuredOrigin || new URL(request.url).origin;
  return `${origin.replace(/\/$/, '')}/.netlify/functions/${functionName}`;
}

/**
 * VPS workers poll durable database rows, so an HTTP wake-up is unnecessary.
 * Netlify still needs the platform background-function invocation.
 */
export function shouldTriggerBackgroundFunction(): boolean {
  return !isVpsRuntime();
}
