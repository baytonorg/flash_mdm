import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PolicyFormSection from '@/components/policy/PolicyFormSection';

describe('PolicyFormSection systemUpdates freeze periods', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides unset and non-windowed times without synthesizing midnight values', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PolicyFormSection category="systemUpdates" config={{}} onChange={onChange} />,
    );

    expect(screen.getByRole('switch', { name: 'Configure System update policy' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Eligible UUC rules may control OEM OS updates/)).toBeInTheDocument();
    expect(screen.getByText(/does not control Google Play system updates \(Mainline\) or Google system services/)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Manufacturer default/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Window Start Time')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Window End Time')).not.toBeInTheDocument();

    rerender(
      <PolicyFormSection
        category="systemUpdates"
        config={{ systemUpdate: { type: 'AUTOMATIC' } }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('switch', { name: 'Configure System update policy' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('System update policy is authoritative for OEM OS updates')).toBeInTheDocument();
    expect(screen.getByText(/More granular UUC rules for OEM updates are ignored/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Automatic/ })).toBeChecked();
    expect(screen.queryByLabelText('Window Start Time')).not.toBeInTheDocument();
  });

  it('uses an explicit switch to create or remove System update policy', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PolicyFormSection category="systemUpdates" config={{}} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Configure System update policy' }));
    expect(onChange).toHaveBeenCalledWith('systemUpdate.type', 'SYSTEM_UPDATE_TYPE_UNSPECIFIED');

    rerender(
      <PolicyFormSection
        category="systemUpdates"
        config={{ systemUpdate: { type: 'SYSTEM_UPDATE_TYPE_UNSPECIFIED' } }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radio', { name: /Manufacturer default/ })).toBeChecked();
    expect(screen.getByText('System update policy is authoritative for OEM OS updates')).toBeInTheDocument();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const configuredSwitch = screen.getByRole('switch', { name: 'Configure System update policy' });
    fireEvent.click(configuredSwitch);
    expect(onChange).not.toHaveBeenCalledWith('systemUpdate', undefined);
    fireEvent.click(configuredSwitch);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledWith('systemUpdate', undefined);
  });

  it('preserves window values and clears them when switching away from Windowed', () => {
    const onChange = vi.fn();
    render(
      <PolicyFormSection
        category="systemUpdates"
        config={{ systemUpdate: { type: 'WINDOWED', startMinutes: 60, endMinutes: 180 } }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText('Window Start Time')).toHaveValue('01:00');
    expect(screen.getByLabelText('Window End Time')).toHaveValue('03:00');
    fireEvent.click(screen.getByRole('radio', { name: /Postpone/ }));
    expect(onChange).toHaveBeenCalledWith('systemUpdate.type', 'POSTPONE');
    expect(onChange).toHaveBeenCalledWith('systemUpdate.startMinutes', undefined);
    expect(onChange).toHaveBeenCalledWith('systemUpdate.endMinutes', undefined);
  });

  it('keeps Manufacturer default inside the configured state and removes incompatible freeze periods explicitly', () => {
    const onChange = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <PolicyFormSection
        category="systemUpdates"
        config={{
          systemUpdate: {
            type: 'AUTOMATIC',
            freezePeriods: [{
              startDate: { month: 1, day: 10 },
              endDate: { month: 1, day: 19 },
            }],
          },
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Manufacturer default/ }));
    expect(window.confirm).toHaveBeenCalledWith('Manufacturer default cannot use freeze periods. Remove the configured freeze periods and continue?');
    expect(onChange).toHaveBeenCalledWith('systemUpdate.freezePeriods', undefined);
    expect(onChange).toHaveBeenCalledWith('systemUpdate.type', 'SYSTEM_UPDATE_TYPE_UNSPECIFIED');
  });

  it('maps start month/day + duration to AMAPI freezePeriods without year fields', async () => {
    const onChange = vi.fn();

    render(
      <PolicyFormSection
        category="systemUpdates"
        config={{
          systemUpdate: {
            type: 'AUTOMATIC',
            freezePeriods: [
              {
                startDate: { month: 1, day: 10 },
                endDate: { month: 1, day: 19 },
              },
            ],
          },
        }}
        onChange={onChange}
      />,
    );

    const durationInput = screen.getByRole('spinbutton');
    fireEvent.change(durationInput, { target: { value: '40' } });

    const calls = onChange.mock.calls.filter((call) => call[0] === 'systemUpdate.freezePeriods');
    expect(calls.length).toBeGreaterThan(0);

    const lastValue = calls.at(-1)?.[1] as Array<{
      startDate: { month: number; day: number; year?: number };
      endDate: { month: number; day: number; year?: number };
    }>;
    expect(lastValue).toEqual([
      {
        startDate: { month: 1, day: 10 },
        endDate: { month: 2, day: 18 },
      },
    ]);
    expect(lastValue[0]?.startDate).not.toHaveProperty('year');
    expect(lastValue[0]?.endDate).not.toHaveProperty('year');
  });
});
