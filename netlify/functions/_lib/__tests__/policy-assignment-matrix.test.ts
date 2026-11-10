import { describe, expect, it } from 'vitest';
import { DEFAULT_PERMISSION_MATRIX, mergePermissionMatrixWithDefaults as runtimeMerge } from '../rbac.js';
import {
  mergePermissionMatrixWithDefaults,
  resolvePolicyAssignmentMinimum,
  validateAndCanonicalizePermissionMatrix,
} from '../rbac-matrix.js';

describe('policy assignment matrix compatibility', () => {
  it('keeps generic editing at Member and assignment at Admin', () => {
    expect(DEFAULT_PERMISSION_MATRIX.policy).toMatchObject({ write: 'member', assign: 'admin' });
    expect(DEFAULT_PERMISSION_MATRIX.group.write).toBe('member');
  });

  it.each([
    [{}, 'admin'],
    [{ policy: { write: 'owner' } }, 'owner'],
    [{ group: { write: 'owner' } }, 'owner'],
    [{ policy: { assign: 'owner', write: 'member' } }, 'owner'],
    [{ policy: { assign: 'admin', write: 'owner' } }, 'admin'],
    [{ policy: { assign: 'member' } }, 'admin'],
  ])('uses identical runtime and operator merge for %j', (input, expected) => {
    expect(mergePermissionMatrixWithDefaults(input).policy.assign).toBe(expected);
    expect(runtimeMerge(input)).toEqual(mergePermissionMatrixWithDefaults(input));
  });

  it('preserves workspace group Owner restriction through a legacy environment override', () => {
    const workspace = { group: { write: 'owner' }, policy: { assign: 'admin' } };
    const environment = { policy: { write: 'member' } };
    expect(resolvePolicyAssignmentMinimum(workspace, environment)).toBe('owner');
    expect(resolvePolicyAssignmentMinimum(workspace, { policy: { assign: 'admin' } })).toBe('admin');
  });

  it('inherits workspace settings when no environment override exists', () => {
    expect(resolvePolicyAssignmentMinimum({ policy: { assign: 'owner' } })).toBe('owner');
  });

  it('rejects rather than silently clamps an explicit below-floor update', () => {
    const matrix = structuredClone(DEFAULT_PERMISSION_MATRIX);
    matrix.policy.assign = 'member';
    expect(() => validateAndCanonicalizePermissionMatrix(matrix)).toThrow('policy.assign cannot be lower than admin');
    matrix.policy.assign = 'owner';
    expect(validateAndCanonicalizePermissionMatrix(matrix).policy.assign).toBe('owner');
  });
});
