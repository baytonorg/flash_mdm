import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Licenses from '@/pages/Licenses';

const mocks = vi.hoisted(() => ({
  role: 'member' as 'member' | 'admin',
  environmentRole: 'member' as 'member' | 'admin',
  accessScope: 'workspace' as 'workspace' | 'scoped',
  isSuperadmin: false,
  invalidateQueries: vi.fn(),
  assignMutate: vi.fn(),
  unassignMutate: vi.fn(),
  checkoutMutate: vi.fn(),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mocks.invalidateQueries,
    }),
    useMutation: () => ({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
    }),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      if (Array.isArray(queryKey) && queryKey[0] === 'license-plans') {
        return {
          data: {
            plans: [
              { id: 'plan_pro', name: 'Pro', max_devices: 100, stripe_price_id: 'price_123', features: {} },
            ],
          },
        };
      }
      if (Array.isArray(queryKey) && queryKey[0] === 'devices-for-license') {
        return {
          data: {
            devices: [
              { id: 'dev_1', name: 'Device One', state: 'ACTIVE', license_id: null },
            ],
          },
        };
      }
      return { data: undefined };
    },
  };
});

vi.mock('@/stores/auth', () => ({
  useAuthStore: (selector?: (state: { user: unknown }) => unknown) => {
    const state = {
      user: {
        id: 'u_1',
        is_superadmin: mocks.isSuperadmin,
        impersonation: null,
      },
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/context', () => ({
  useContextStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      activeWorkspace: { id: 'ws_1', user_role: mocks.role, access_scope: mocks.accessScope },
      activeEnvironment: { id: 'env_1', user_role: mocks.environmentRole },
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/api/queries/licenses', () => ({
  useLicenseStatus: () => ({
    data: {
      license: {
        id: 'lic_1',
        workspace_id: 'ws_1',
        plan_id: 'plan_free',
        stripe_subscription_id: 'sub_123',
        status: 'active',
        current_period_end: null,
        created_at: '',
        updated_at: '',
      },
      plan: {
        id: 'plan_free',
        name: 'Free',
        max_devices: 10,
        features: {},
      },
      device_count: 1,
      device_limit: 10,
      usage_percentage: 10,
      stripe_enabled: true,
      environments: [
        {
          environment_id: 'env_1',
          environment_name: 'Testing',
          workspace_id: 'ws_1',
          active_device_count: 1,
          entitled_seats: 1,
          overage_count: 0,
          open_case_id: null,
          overage_started_at: null,
          overage_age_days: 0,
          overage_phase: 'resolved',
          enrollment_blocked: false,
        },
      ],
    },
    isLoading: false,
  }),
  useCreateCheckout: () => ({
    mutate: mocks.checkoutMutate,
    isPending: false,
  }),
  useAssignLicense: () => ({
    mutate: mocks.assignMutate,
    isPending: false,
  }),
  useUnassignLicense: () => ({
    mutate: mocks.unassignMutate,
    isPending: false,
  }),
}));

describe('Licenses page role gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'member';
    mocks.environmentRole = 'member';
    mocks.accessScope = 'workspace';
    mocks.isSuperadmin = false;
  });

  it('shows read-only licensing UI for member users', () => {
    render(<Licenses />);

    expect(screen.getByText('Environment licence usage')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Used')).toBeInTheDocument();
    expect(screen.getByText('Remaining')).toBeInTheDocument();
    expect(screen.getByText('Compliant')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay with Stripe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Billing Config' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Environment' })).not.toBeInTheDocument();
  });

  it('shows mutating controls for admin users', () => {
    mocks.role = 'admin';
    mocks.environmentRole = 'admin';
    mocks.accessScope = 'workspace';

    render(<Licenses />);

    expect(screen.queryByText('Read-only licensing view. Billing actions require workspace admin or owner access.')).not.toBeInTheDocument();
    expect(screen.getByText('Payment and history')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay with Stripe' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Configure plans & pricing' }));
    expect(screen.getByRole('button', { name: 'Save billing config' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Environment' }));
    expect(screen.getByText('Environment licences')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checkout for environment' })).toBeInTheDocument();
    expect(screen.getByText('Grant licences manually (no Stripe)')).toBeInTheDocument();
  });

  it('hides workspace tab and allows environment billing for scoped env admins', () => {
    mocks.role = 'admin';
    mocks.environmentRole = 'admin';
    mocks.accessScope = 'scoped';

    render(<Licenses />);

    expect(screen.queryByRole('button', { name: 'Workspace' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Environment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checkout for environment' })).toBeInTheDocument();
    expect(screen.queryByText('Grant licences manually (no Stripe)')).not.toBeInTheDocument();
    expect(screen.queryByText('Read-only licensing view. Billing actions require workspace admin or owner access.')).not.toBeInTheDocument();
  });
});
