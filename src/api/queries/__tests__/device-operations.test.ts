import { describe, expect, it } from 'vitest';
import { getDeviceOperationsRefetchInterval } from '../device-operations';

describe('device operation refresh lifecycle', () => {
  it('polls while any operation remains in progress', () => {
    expect(getDeviceOperationsRefetchInterval({
      operations: [{ name: 'operations/running', done: false }],
    })).toBe(3000);
  });

  it('stops polling when all operations are terminal', () => {
    expect(getDeviceOperationsRefetchInterval({
      operations: [
        { name: 'operations/done', done: true },
        { name: 'operations/cancelled', error: { code: 1, message: 'Cancelled' } },
      ],
    })).toBe(false);
  });

  it('continues polling while persistent reconciliation is active', () => {
    expect(getDeviceOperationsRefetchInterval({
      operations: [{
        name: 'ledger/1',
        done: false,
        ledgerStatus: 'reconciling',
        error: { code: 0, message: 'Read-only reconciliation is in progress.' },
      }],
    })).toBe(3000);
  });
});
