// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const spec = JSON.parse(readFileSync('public/openapi.json', 'utf8'));
describe('published assignment API contract', () => {
  it('publishes only implemented mutation methods and the distinct authority floor', () => {
    for (const action of ['assign', 'unassign', 'locks']) {
      const path = spec.paths[`/api/policies/${action}`];
      expect(Object.keys(path)).toEqual(['post']);
      expect(path.post['x-flash-auth'].policyAssignmentMinimum).toBe(action === 'locks' ? 'admin' : 'policy.assign (admin floor)');
      expect(path.post.responses['409']).toBeDefined();
    }
  });
  it('documents the observed-generation precondition and explicit lock fields', () => {
    const body = spec.paths['/api/policies/locks'].post.requestBody.content['application/json'].schema;
    expect(body.required).toEqual(expect.arrayContaining(['scope_type', 'scope_id', 'policy_id', 'expected_version', 'locked', 'locked_sections']));
    expect(body.properties.expected_version.pattern).toBe('^[a-f0-9]{32}$');
    expect(spec.paths['/api/policies/assign'].post.requestBody.content['application/json'].schema.description).toContain('Lock fields are rejected with 409');
  });
});
