import { describe, it, expect } from 'vitest';
import { buildPolicyUpdateMask } from '../policy-update-mask.js';

const ENABLED = process.env.AMAPI_LIVE_POLICY_TEST_ENABLE === '1';
const BEARER = process.env.AMAPI_LIVE_BEARER_TOKEN;
const POLICY_NAME = process.env.AMAPI_LIVE_POLICY_NAME;
const BASELINE_JSON = process.env.AMAPI_LIVE_POLICY_BASELINE_JSON;
const PATCH_JSON = process.env.AMAPI_LIVE_POLICY_PATCH_JSON;
const EXPECT_CLEARED_KEY = process.env.AMAPI_LIVE_EXPECT_CLEARED_TOP_LEVEL_KEY;

async function amapiFetch(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`https://androidmanagement.googleapis.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${BEARER}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // keep raw text
  }

  if (!res.ok) {
    throw new Error(`AMAPI ${res.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }

  return parsed as Record<string, unknown>;
}

describe('policy patch deep-clear semantics (live AMAPI, opt-in)', () => {
  it('verifies a nested clear scenario against a dedicated sandbox policy', async () => {
    if (!ENABLED) {
      expect(true).toBe(true);
      return;
    }

    if (!BEARER || !POLICY_NAME || !BASELINE_JSON || !PATCH_JSON || !EXPECT_CLEARED_KEY) {
      throw new Error('Missing required AMAPI_LIVE_* env vars for live policy patch test');
    }

    // This test mutates a real AMAPI policy and then restores it.
    // Use a dedicated sandbox policy only.
    const baseline = JSON.parse(BASELINE_JSON) as Record<string, unknown>;
    const patch = JSON.parse(PATCH_JSON) as Record<string, unknown>;

    const original = await amapiFetch(POLICY_NAME);

    try {
      const baselineMask = buildPolicyUpdateMask({}, baseline);
      await amapiFetch(
        baselineMask ? `${POLICY_NAME}?updateMask=${encodeURIComponent(baselineMask)}` : POLICY_NAME,
        'PATCH',
        baseline
      );

      const patchMask = buildPolicyUpdateMask(baseline, patch);
      await amapiFetch(
        patchMask ? `${POLICY_NAME}?updateMask=${encodeURIComponent(patchMask)}` : POLICY_NAME,
        'PATCH',
        patch
      );

      const after = await amapiFetch(POLICY_NAME);
      expect(Object.prototype.hasOwnProperty.call(after, EXPECT_CLEARED_KEY)).toBe(false);
    } finally {
      const restoreMask = buildPolicyUpdateMask(patch, original);
      await amapiFetch(
        restoreMask ? `${POLICY_NAME}?updateMask=${encodeURIComponent(restoreMask)}` : POLICY_NAME,
        'PATCH',
        original
      );
    }
  });
});

