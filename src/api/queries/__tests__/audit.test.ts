import { describe, expect, it } from 'vitest';
import { auditKeys, buildAuditQuery } from '../audit';

describe('audit query contract', () => {
  it('keeps a family distinct from an exact action in requests and cache keys', () => {
    const params={environment_id:'env_1',action_family:'device_commands'};
    expect(buildAuditQuery(params)).toBe('environment_id=env_1&action_family=device_commands');
    expect(auditKeys.list(params)).not.toEqual(auditKeys.list({environment_id:'env_1',action:'device_commands'}));
  });
  it('includes the action filter in the request and query key', () => {
    const params = {
      environment_id: 'env_1',
      page: 2,
      per_page: 25,
      action: 'device.delete',
    };

    expect(buildAuditQuery(params)).toBe(
      'environment_id=env_1&page=2&per_page=25&action=device.delete',
    );
    expect(auditKeys.list(params)).toEqual(['audit', 'list', params]);
  });
});
