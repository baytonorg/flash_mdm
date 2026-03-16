import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SuperadminDashboard } from '@/pages/Superadmin';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  settingsMutate: vi.fn(),
  migrationsMutate: vi.fn(),
  planMutate: vi.fn(),
  mutationCall: 0,
  statsData: {
    total_workspaces: 4,
    total_environments: 6,
    total_devices: 20,
    total_users: 8,
    devices_by_plan: [{ plan_name: 'Pro', device_count: 20 }],
    recent_signups: [{ date: '2026-02-01', count: 2 }],
  },
  settingsData: {
    invite_only_registration: false,
    licensing_enabled: true,
    default_free_enabled: true,
    default_free_seat_limit: 10,
  },
  planData: {
    plans: [
      {
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Pro',
        max_devices: 100,
        stripe_price_id: 'price_old',
        unit_amount_cents: 500,
        currency: 'usd',
        features: { stripe_interval_months: 1 },
      },
    ],
  },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
    }),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      if (Array.isArray(queryKey) && queryKey[0] === 'superadmin' && queryKey[1] === 'stats') {
        return {
          data: mocks.statsData,
          isLoading: false,
          dataUpdatedAt: Date.now(),
        };
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'superadmin' && queryKey[1] === 'settings') {
        return {
          data: mocks.settingsData,
          isLoading: false,
        };
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'superadmin' && queryKey[1] === 'license-plans') {
        return {
          data: mocks.planData,
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    },
    useMutation: () => {
      mocks.mutationCall += 1;
      const mutate = mocks.mutationCall === 1
        ? mocks.settingsMutate
        : mocks.mutationCall === 2
          ? mocks.migrationsMutate
          : mocks.planMutate;
      return {
        mutate,
        isPending: false,
        isError: false,
        error: null,
        data: undefined,
      };
    },
  };
});

vi.mock('@/components/common/LivePageIndicator', () => ({
  default: () => null,
}));

describe('SuperadminDashboard plan catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutationCall = 0;
  });

  it('renders the platform plan catalog controls', () => {
    render(<SuperadminDashboard />);

    expect(screen.getByText('Platform Plan Catalogue')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pro')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Stripe Price' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add + Stripe Price' })).toBeInTheDocument();
  });

  it('sends create_stripe_price payload when clicking plan row button', () => {
    render(<SuperadminDashboard />);

    const createStripePriceButton = screen.getByRole('button', { name: 'Create Stripe Price' }) as HTMLButtonElement;
    expect(createStripePriceButton.disabled).toBe(true);

    fireEvent.change(screen.getByDisplayValue('price_old'), { target: { value: '' } });
    expect(createStripePriceButton.disabled).toBe(false);
    fireEvent.click(createStripePriceButton);

    expect(mocks.planMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '323e4567-e89b-12d3-a456-426614174000',
        name: 'Pro',
        create_stripe_price: true,
        unit_amount_cents: 500,
        currency: 'usd',
        stripe_interval_months: 1,
      }),
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    );
  });

  it('preserves unsaved edits in other rows when plan data refetches', () => {
    mocks.planData = {
      plans: [
        {
          id: 'plan_1',
          name: 'Starter',
          max_devices: 10,
          stripe_price_id: 'price_starter',
          unit_amount_cents: 100,
          currency: 'usd',
          features: { stripe_interval_months: 1 },
        },
        {
          id: 'plan_2',
          name: 'Growth',
          max_devices: 100,
          stripe_price_id: 'price_growth',
          unit_amount_cents: 500,
          currency: 'usd',
          features: { stripe_interval_months: 1 },
        },
      ],
    };

    const { rerender } = render(<SuperadminDashboard />);

    fireEvent.change(screen.getByDisplayValue('Starter'), { target: { value: 'Starter Edited' } });
    expect(screen.getByDisplayValue('Starter Edited')).toBeInTheDocument();

    // Simulate refetch after saving another row; untouched rows receive server updates.
    mocks.planData = {
      plans: [
        {
          id: 'plan_1',
          name: 'Starter',
          max_devices: 10,
          stripe_price_id: 'price_starter',
          unit_amount_cents: 100,
          currency: 'usd',
          features: { stripe_interval_months: 1 },
        },
        {
          id: 'plan_2',
          name: 'Growth Server Updated',
          max_devices: 100,
          stripe_price_id: 'price_growth_new',
          unit_amount_cents: 900,
          currency: 'gbp',
          features: { stripe_interval_months: 12 },
        },
      ],
    };

    rerender(<SuperadminDashboard />);

    expect(screen.getByDisplayValue('Starter Edited')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Growth Server Updated')).toBeInTheDocument();
  });

  it('shows unsaved changes indicator for edited rows', () => {
    mocks.planData = {
      plans: [
        {
          id: '323e4567-e89b-12d3-a456-426614174000',
          name: 'Pro',
          max_devices: 100,
          stripe_price_id: 'price_old',
          unit_amount_cents: 500,
          currency: 'usd',
          features: { stripe_interval_months: 1 },
        },
      ],
    };
    render(<SuperadminDashboard />);

    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Pro'), { target: { value: 'Pro Plus' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });
});
