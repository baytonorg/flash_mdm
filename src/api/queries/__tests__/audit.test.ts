import { describe, expect, it } from 'vitest';
import { auditKeys, buildAuditQuery } from '../audit';

describe('audit query contract', () => {
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
