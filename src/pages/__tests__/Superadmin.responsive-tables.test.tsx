import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuperadminUsers, SuperadminWorkspaces } from '@/pages/Superadmin';

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: false,
      error: null,
      data: undefined,
    }),
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[1] === 'workspaces') {
        return {
          data: {
            workspaces: [{
              id: 'workspace-1',
              name: 'A deliberately long workspace name used for responsive coverage',
              created_at: '2026-10-02T08:00:00.000Z',
              device_count: 120,
              user_count: 35,
              plan_name: 'Enterprise',
              license_status: 'active',
            }],
            total: 1,
            page: 1,
            per_page: 20,
          },
          isLoading: false,
        };
      }
      if (queryKey[1] === 'users') {
        return {
          data: {
            users: [{
              id: 'user-1',
              email: 'a.deliberately.long.user.address@example-enterprise.test',
              first_name: 'Responsive',
              last_name: 'Coverage',
              is_superadmin: false,
              totp_enabled: true,
              workspace_count: 1,
              workspaces: [{
                id: 'workspace-1',
                name: 'A deliberately long workspace name used for responsive coverage',
                role: 'admin',
                access_scope: 'workspace',
                environment_count: 4,
                group_count: 8,
              }],
              last_login_at: '2026-10-02T08:00:00.000Z',
              last_login_method: 'passkey',
              created_at: '2026-01-01T00:00:00.000Z',
            }],
            total: 1,
            page: 1,
            per_page: 25,
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    },
  };
});

vi.mock('@/components/users/UserAccessAssignmentsModal', () => ({ default: () => null }));

describe.each([375, 1024, 1440])('custom table reachability at %ipx', (viewportWidth) => {
  it('keeps workspace and user columns inside bounded horizontal scrollers', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
    window.dispatchEvent(new Event('resize'));

    const workspaces = render(<SuperadminWorkspaces />);
    const workspaceScroller = screen.getByLabelText('Workspaces table');
    expect(workspaceScroller).toHaveClass('max-w-full', 'overflow-x-auto');
    expect(workspaceScroller).toHaveAttribute('tabindex', '0');
    expect(workspaceScroller.querySelector('table')).toHaveClass('min-w-[840px]');
    const workspaceListColumn = workspaceScroller.parentElement?.parentElement;
    expect(workspaceListColumn).toHaveClass('min-w-0', 'flex-1');
    expect(workspaceListColumn?.parentElement).toHaveClass('flex-col', 'xl:flex-row');
    workspaces.unmount();

    render(<SuperadminUsers />);
    const userScroller = screen.getByLabelText('Users table');
    expect(userScroller).toHaveClass('max-w-full', 'overflow-x-auto');
    expect(userScroller).toHaveAttribute('tabindex', '0');
    expect(userScroller.querySelector('table')).toHaveClass('min-w-[1100px]');
  });
});
