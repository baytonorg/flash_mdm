import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import AmapiApplicationPolicyEditor from '@/components/apps/AmapiApplicationPolicyEditor';

function fieldSection(label: string): HTMLElement {
  const el = screen.getByText(label);
  const section = el.closest('.py-3');
  if (!section) throw new Error(`Could not find section for label: ${label}`);
  return section as HTMLElement;
}

describe('AmapiApplicationPolicyEditor', () => {
  it('renders form mode by default and can switch to JSON mode', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState<Record<string, unknown>>({});
      return <AmapiApplicationPolicyEditor value={value} onChange={setValue} packageName="com.example.app" installType="AVAILABLE" autoUpdateMode="AUTO_UPDATE_DEFAULT" />;
    }

    render(<Harness />);

    expect(screen.getByText('Application Policy Fields')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'JSON' }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('updates roles as a multi-select list of role objects', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();

    function Harness() {
      const [value, setValue] = useState<Record<string, unknown>>({});
      return (
        <AmapiApplicationPolicyEditor
          value={value}
          onChange={(next) => {
            onChangeSpy(next);
            setValue(next);
          }}
          installType="AVAILABLE"
        />
      );
    }

    render(<Harness />);

    await user.click(screen.getByRole('checkbox', { name: 'COMPANION_APP' }));
    expect(onChangeSpy).toHaveBeenLastCalledWith({
      roles: [{ roleType: 'COMPANION_APP' }],
    });

    await user.click(screen.getByRole('checkbox', { name: 'KIOSK' }));
    expect(onChangeSpy).toHaveBeenLastCalledWith({
      roles: [{ roleType: 'COMPANION_APP' }, { roleType: 'KIOSK' }],
    });
  });

  it('adds delegated scope rows using enum defaults (regression)', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();

    function Harness() {
      const [value, setValue] = useState<Record<string, unknown>>({});
      return (
        <AmapiApplicationPolicyEditor
          value={value}
          onChange={(next) => {
            onChangeSpy(next);
            setValue(next);
          }}
          installType="AVAILABLE"
        />
      );
    }

    render(<Harness />);

    const delegatedScopesSection = fieldSection('Delegated Scopes');
    await user.click(within(delegatedScopesSection).getByRole('button', { name: /add item/i }));

    expect(onChangeSpy).toHaveBeenLastCalledWith({
      delegatedScopes: ['DELEGATED_SCOPE_UNSPECIFIED'],
    });

    expect(within(delegatedScopesSection).getByRole('option', { name: 'CERT_INSTALL' })).toBeInTheDocument();
    expect(within(delegatedScopesSection).getByRole('option', { name: 'SECURITY_LOGS' })).toBeInTheDocument();
  });

  it('hides deprecated extensionConfig in form mode and keeps JSON mode available', async () => {
    const user = userEvent.setup();

    render(
      <AmapiApplicationPolicyEditor
        value={{}}
        onChange={() => {}}
        installType="AVAILABLE"
      />
    );

    expect(screen.queryByText('Extension Config')).not.toBeInTheDocument();
    expect(screen.getByText(/extensionConfig.*deprecated/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'JSON' }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows customAppConfig only when installType is CUSTOM', () => {
    const { rerender } = render(
      <AmapiApplicationPolicyEditor
        value={{}}
        onChange={() => {}}
        installType="AVAILABLE"
      />
    );

    expect(screen.queryByText('Custom App Configuration')).not.toBeInTheDocument();
    expect(screen.queryByText('Managed Configuration Template')).not.toBeInTheDocument();

    rerender(
      <AmapiApplicationPolicyEditor
        value={{}}
        onChange={() => {}}
        installType="CUSTOM"
      />
    );

    expect(screen.getByText('Custom App Configuration')).toBeInTheDocument();
    expect(screen.queryByText('Managed Configuration Template')).not.toBeInTheDocument();
  });
});
