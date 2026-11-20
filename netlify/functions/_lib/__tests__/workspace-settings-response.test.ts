import { describe, it, expect } from 'vitest';
import { workspaceResponse, workspaceSettingsResponse } from '../workspace-settings-response.js';

describe('generic workspace settings response', () => {
  it('keeps documented UI settings while excluding provider envelopes and unknown nested fields', () => {
    const stored = {
      flashagent: { openai_api_key_enc: 'inert-fixture-envelope', model: 'fixture' },
      future_secret: 'inert-fixture-envelope',
      device_health: { stale_after_days: 14, future_secret: 'inert-fixture-envelope' },
      rbac: { secret: 'inert-fixture-envelope', permission_matrix: {
        workspace: { manage_settings: 'owner', future_secret: 'inert-fixture-envelope' },
        audit: { read: 'admin' }, unknown: { read: 'owner' },
      } },
    };
    const before = JSON.stringify(stored);
    expect(workspaceSettingsResponse(stored)).toEqual({device_health:{stale_after_days:14},rbac:{permission_matrix:{workspace:{manage_settings:'owner'},audit:{read:'admin'}}}});
    expect(JSON.stringify(stored)).toBe(before);
  });
  it.each([null, undefined, [], 'inert-fixture-envelope', 2])('rejects invalid root %j', value => {
    expect(workspaceSettingsResponse(value)).toEqual({});
  });
  it('rejects malformed nested values and invalid roles without replacing stored overrides with defaults', () => {
    expect(workspaceSettingsResponse({device_health:{stale_after_days:366},rbac:{permission_matrix:{workspace:{read:'invalid',write:2},device:[]}}})).toEqual({rbac:{permission_matrix:{}}});
    expect(workspaceSettingsResponse({device_health:[],rbac:[]})).toEqual({});
    expect(workspaceSettingsResponse({device_health:{stale_after_days:1.5}})).toEqual({});
  });
  it('returns a new response object and never modifies stored settings', () => {
    const original={id:'fixture',settings:{protected:'inert-fixture-envelope'}};
    expect(workspaceResponse(original)).toEqual({id:'fixture',settings:{}});
    expect(original.settings.protected).toBe('inert-fixture-envelope');
  });
});
