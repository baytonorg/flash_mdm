import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PolicyFormSection from '@/components/policy/PolicyFormSection';

describe('PolicyFormSection systemUpdates freeze periods', () => {
  it('maps start month/day + duration to AMAPI freezePeriods without year fields', async () => {
    const onChange = vi.fn();

    render(
      <PolicyFormSection
        category="systemUpdates"
        config={{
          systemUpdate: {
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
