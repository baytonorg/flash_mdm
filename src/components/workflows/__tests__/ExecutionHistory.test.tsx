import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ExecutionHistory from '../ExecutionHistory';

describe('ExecutionHistory', () => {
  it('surfaces delivery-uncertain workflow commands with operator guidance', () => {
    render(
      <ExecutionHistory
        executions={[{
          id: 'exec-1',
          workflow_id: 'workflow-1',
          device_id: 'device-1',
          trigger_data: { schedule: 'daily' },
          status: 'delivery_uncertain',
          result: {
            success: false,
            delivery_uncertain: true,
            automatic_retry: false,
            error: 'AMAPI command delivery is uncertain; verify device operations before retrying.',
          },
          created_at: '2026-09-09T08:00:00Z',
          manufacturer: 'Google',
          model: 'Pixel',
          serial_number: 'SERIAL-1',
        }]}
      />
    );

    expect(screen.getByText('Delivery uncertain')).toBeInTheDocument();
    expect(screen.getByText(/verify device operations before retrying/i)).toBeInTheDocument();
  });
});
