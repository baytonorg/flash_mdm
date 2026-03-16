import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SignupLinkSettings from '../SignupLinkSettings';

const mockUseSignupLink = vi.fn();
const mockUseCreateSignupLink = vi.fn();
const mockUseUpdateSignupLink = vi.fn();
const mockUseDeleteSignupLink = vi.fn();

vi.mock('@/api/queries/signupLinks', () => ({
  useSignupLink: (...args: unknown[]) => mockUseSignupLink(...args),
  useCreateSignupLink: () => mockUseCreateSignupLink(),
  useUpdateSignupLink: () => mockUseUpdateSignupLink(),
  useDeleteSignupLink: () => mockUseDeleteSignupLink(),
}));

function getDefaultRoleSelect(): HTMLSelectElement {
  const label = screen.getByText('Default Role');
  const container = label.parentElement;
  if (!container) throw new Error('Default Role container not found');
  const select = container.querySelector('select');
  if (!select) throw new Error('Default Role select not found');
  return select as HTMLSelectElement;
}

describe('SignupLinkSettings', () => {
  beforeEach(() => {
    mockUseSignupLink.mockReset();
    mockUseCreateSignupLink.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mockUseUpdateSignupLink.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mockUseDeleteSignupLink.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  it('includes admin role option for workspace signup links', () => {
    mockUseSignupLink.mockReturnValue({ data: null, isLoading: false });

    render(
      <SignupLinkSettings
        scopeType="workspace"
        scopeId="ws_1"
        environments={[]}
        groups={[]}
      />
    );

    const select = getDefaultRoleSelect();
    const options = Array.from(select.options).map((opt) => opt.value);
    expect(options).toContain('admin');
  });

  it('includes admin role option for environment signup links', () => {
    mockUseSignupLink.mockReturnValue({ data: null, isLoading: false });

    render(
      <SignupLinkSettings
        scopeType="environment"
        scopeId="env_1"
        environments={[]}
        groups={[]}
      />
    );

    const select = getDefaultRoleSelect();
    const options = Array.from(select.options).map((opt) => opt.value);
    expect(options).toContain('admin');
  });
});
