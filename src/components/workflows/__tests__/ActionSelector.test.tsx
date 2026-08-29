import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ActionSelector, { type ActionValue } from '../ActionSelector';
import {
  WORKFLOW_AMAPI_COMMANDS,
  validateWorkflowCommandConfig,
} from '../../../../shared/amapi-workflow-commands';

function ControlledActionSelector() {
  const [value, setValue] = useState<ActionValue>({
    action_type: 'device.command',
    action_config: {},
  });
  return <ActionSelector value={value} onChange={setValue} />;
}

describe('workflow AMAPI command configuration', () => {
  it('keeps the workflow picker aligned with the shared documented schema', () => {
    render(<ControlledActionSelector />);

    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual([
      'Select a command...',
      ...WORKFLOW_AMAPI_COMMANDS.map((command) => command.label),
    ]);
  });

  it('collects CLEAR_APP_DATA package name and clears stale command data on type change', async () => {
    const user = userEvent.setup();
    render(<ControlledActionSelector />);

    await user.selectOptions(screen.getByRole('combobox'), 'CLEAR_APP_DATA');
    const packageName = screen.getByLabelText('Package Name *');
    expect(packageName).toBeRequired();
    expect(screen.getByRole('alert')).toHaveTextContent('requires a package name');

    await user.type(packageName, 'com.example.app');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox'), 'LOCK');
    await user.selectOptions(screen.getByRole('combobox'), 'CLEAR_APP_DATA');
    expect(screen.getByLabelText('Package Name *')).toHaveValue('');
  });

  it('collects every documented lost-mode display field and rejects organization alone', async () => {
    const user = userEvent.setup();
    render(<ControlledActionSelector />);

    await user.selectOptions(screen.getByRole('combobox'), 'START_LOST_MODE');

    expect(screen.getByLabelText('Lock Screen Message')).toBeInTheDocument();
    expect(screen.getByLabelText('Contact Phone Number')).toBeInTheDocument();
    expect(screen.getByLabelText('Contact Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Street Address')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization (optional)')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Organization (optional)'), 'Example Organization');
    expect(screen.getByRole('alert')).toHaveTextContent('organization alone is not sufficient');

    await user.type(screen.getByLabelText('Lock Screen Message'), 'Please return this device');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('rejects unknown and incomplete API-created workflow configurations', () => {
    expect(validateWorkflowCommandConfig({ command_type: 'FUTURE_COMMAND' }))
      .toBe('Unsupported workflow command type: FUTURE_COMMAND');
    expect(validateWorkflowCommandConfig({
      command_type: 'START_LOST_MODE',
      command_data: {
        startLostModeParams: {
          lostOrganization: { defaultMessage: 'Example Organization' },
        },
      },
    })).toContain('organization alone is not sufficient');
  });
});
