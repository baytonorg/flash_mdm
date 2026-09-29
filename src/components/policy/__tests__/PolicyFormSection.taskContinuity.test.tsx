import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import PolicyFormSection from '@/components/policy/PolicyFormSection';

function selectOption(fieldLabel: string, option: string) {
  const field = screen.getByText(fieldLabel).parentElement;
  expect(field).not.toBeNull();
  fireEvent.click(within(field!).getByRole('radio', { name: option }));
}

describe('PolicyFormSection task continuity handoff', () => {
  it('reads and writes the top-level cross-device policy', () => {
    const onChange = vi.fn();
    render(
      <PolicyFormSection
        category="crossDevice"
        config={{ crossDevicePolicies: { taskContinuityHandoff: 'TASK_CONTINUITY_HANDOFF_ALLOWED' } }}
        onChange={onChange}
      />,
    );

    const field = screen.getByText('Task Continuity Handoff').parentElement;
    expect(within(field!).getByRole('radio', { name: 'Allowed' })).toBeChecked();

    selectOption('Task Continuity Handoff', 'Disallowed');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      'crossDevicePolicies.taskContinuityHandoff',
      'TASK_CONTINUITY_HANDOFF_DISALLOWED',
    );
  });

  it('reads and writes the personal-profile cross-device policy', () => {
    const onChange = vi.fn();
    render(
      <PolicyFormSection
        category="personalUsage"
        config={{
          personalUsagePolicies: {
            crossDevicePolicies: { taskContinuityHandoff: 'TASK_CONTINUITY_HANDOFF_DISALLOWED' },
          },
        }}
        onChange={onChange}
      />,
    );

    const field = screen.getByText('Personal Task Continuity Handoff').parentElement;
    expect(within(field!).getByRole('radio', { name: 'Disallowed' })).toBeChecked();

    selectOption('Personal Task Continuity Handoff', 'Allowed');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      'personalUsagePolicies.crossDevicePolicies.taskContinuityHandoff',
      'TASK_CONTINUITY_HANDOFF_ALLOWED',
    );
  });
});
