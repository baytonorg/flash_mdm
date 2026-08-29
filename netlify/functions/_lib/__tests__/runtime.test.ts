import { afterEach, describe, expect, it } from 'vitest';
import {
  internalFunctionUrl,
  isVpsRuntime,
  shouldTriggerBackgroundFunction,
} from '../runtime.js';

const originalRuntime = process.env.FLASH_RUNTIME;
const originalOrigin = process.env.FLASH_INTERNAL_ORIGIN;

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.FLASH_RUNTIME;
  else process.env.FLASH_RUNTIME = originalRuntime;
  if (originalOrigin === undefined) delete process.env.FLASH_INTERNAL_ORIGIN;
  else process.env.FLASH_INTERNAL_ORIGIN = originalOrigin;
});

describe('VPS runtime background dispatch', () => {
  it('keeps Netlify background wake-ups enabled by default', () => {
    delete process.env.FLASH_RUNTIME;
    expect(isVpsRuntime()).toBe(false);
    expect(shouldTriggerBackgroundFunction()).toBe(true);
  });

  it('uses the private internal origin and disables redundant VPS wake-ups', () => {
    process.env.FLASH_RUNTIME = 'vps';
    process.env.FLASH_INTERNAL_ORIGIN = 'http://127.0.0.1:3000/';

    expect(shouldTriggerBackgroundFunction()).toBe(false);
    expect(internalFunctionUrl(
      new Request('https://flash.example/api/devices/bulk'),
      'sync-process-background'
    )).toBe('http://127.0.0.1:3000/.netlify/functions/sync-process-background');
  });
});
