import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import PlatformUpdatesSection from '@/components/policy/PlatformUpdatesSection';

function expandRule(index = 1) {
  fireEvent.click(screen.getByRole('button', { name: `Expand rule ${index}` }));
}

function ControlledPlatformUpdatesSection({ initialConfig }: { initialConfig: Record<string, unknown> }) {
  const [config, setConfig] = useState(initialConfig);
  return (
    <PlatformUpdatesSection
      config={config}
      onChange={(path, value) => {
        if (path === 'unifiedUpdatePolicy.rules') {
          setConfig((current) => ({
            ...current,
            unifiedUpdatePolicy: {
              ...((current.unifiedUpdatePolicy as Record<string, unknown> | undefined) ?? {}),
              rules: value,
            },
          }));
        } else if (path === 'unifiedUpdatePolicy') {
          setConfig((current) => ({ ...current, unifiedUpdatePolicy: value }));
        }
      }}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlatformUpdatesSection', () => {
  it('shows target-level authority for a partly shadowed mixed rule', () => {
    render(
      <PlatformUpdatesSection
        config={{
          systemUpdate: { type: 'WINDOWED' },
          unifiedUpdatePolicy: {
            rules: [{
              id: 'mixed',
              targets: [
                { targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' },
                { targetType: 'GOOGLE_PLAY_SYSTEM_UPDATE' },
              ],
              outcome: { outcomeType: 'BLOCK' },
            }],
          },
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Platform Updates' })).toBeInTheDocument();
    expect(screen.queryByText('Which control should I use?')).not.toBeInTheDocument();
    expect(screen.queryByText('Device eligibility')).not.toBeInTheDocument();
    expect(screen.queryByText('Important behaviour')).not.toBeInTheDocument();
    const majorRow = screen.getAllByText('Major OS updates')[0]?.closest<HTMLElement>('div[class*="grid"]');
    const mainlineRow = screen.getAllByText('Google Play system updates')[0]?.closest<HTMLElement>('div[class*="grid"]');
    expect(majorRow).not.toBeNull();
    expect(mainlineRow).not.toBeNull();
    expect(within(majorRow!).getByText('System update policy')).toBeInTheDocument();
    expect(within(mainlineRow!).getByText('Unified update controls')).toBeInTheDocument();
    expect(screen.getByText('At least one UUC rule is partly or fully shadowed.')).toBeInTheDocument();
    expandRule();
    expect(screen.getAllByText('Shadowed by System update policy')).toHaveLength(2);
  });

  it('adds a blank ordered rule without synthesising configured defaults', () => {
    const onChange = vi.fn();
    render(<PlatformUpdatesSection config={{}} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(onChange).toHaveBeenCalledWith('unifiedUpdatePolicy.rules', [{
      id: 'update-rule-1',
      _flashName: 'Update rule 1',
      targets: [],
      outcome: { outcomeType: 'OUTCOME_TYPE_UNSPECIFIED' },
    }]);
  });

  it('does not show a coexistence warning when UUC targets only Google-delivered updates', () => {
    render(
      <PlatformUpdatesSection
        config={{
          systemUpdate: { type: 'AUTOMATIC' },
          unifiedUpdatePolicy: {
            rules: [{
              id: 'mainline-only',
              targets: [{ targetType: 'GOOGLE_PLAY_SYSTEM_UPDATE' }],
              outcome: { outcomeType: 'BLOCK' },
            }],
          },
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('System update policy and UUC coexist')).not.toBeInTheDocument();
    const mainlineRow = screen.getAllByText('Google Play system updates')[0]?.closest<HTMLElement>('div[class*="grid"]');
    expect(mainlineRow).not.toBeNull();
    expect(within(mainlineRow!).getByText('Unified update controls')).toBeInTheDocument();
  });

  it('previews migration candidates before adding them and leaves systemUpdate intact', () => {
    const onChange = vi.fn();
    render(
      <PlatformUpdatesSection
        config={{ systemUpdate: { type: 'POSTPONE' } }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generate candidate rules' }));
    expect(screen.getByText(/Postponed OS updates candidate/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Add candidates for editing' }));
    expect(onChange).toHaveBeenCalledWith(
      'unifiedUpdatePolicy.rules',
      expect.arrayContaining([
        expect.objectContaining({
          id: 'candidate-postpone-os-updates',
          outcome: { outcomeType: 'BLOCK' },
        }),
      ]),
    );
    expect(onChange).not.toHaveBeenCalledWith('systemUpdate', undefined);
  });

  it('gates OS-only inputs for non-OS targets', () => {
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [{
              id: 'mainline-only',
              targets: [{ targetType: 'GOOGLE_PLAY_SYSTEM_UPDATE' }],
              outcome: { outcomeType: 'BLOCK' },
            }],
          },
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('At stage')).not.toBeInTheDocument();
    expandRule();
    expect(screen.queryByText('At stage')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'User prompt (OS targets only)' })).toBeDisabled();
    expect(screen.getByLabelText('Rule 1 name')).toHaveAttribute('maxlength', '120');
    expect(screen.getByText('Configuration summary:')).toBeInTheDocument();
  });

  it('enables OS-only inputs for an OS-only rule', () => {
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [{
              id: 'os-only',
              targets: [{ targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' }],
              outcome: { outcomeType: 'USER_PROMPT' },
            }],
          },
        }}
        onChange={vi.fn()}
      />,
    );

    expandRule();
    expect(screen.getByRole('checkbox', { name: 'Download' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Apply' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'User prompt (OS targets only)' })).toBeEnabled();
    expect(screen.getByText('When')).toBeInTheDocument();
    expect(screen.getByText('Always')).toBeInTheDocument();
    expect(screen.getAllByText(/Apply-stage control is best-effort/).length).toBeGreaterThan(0);
  });

  it('allows mixed rules to retain USER_PROMPT while warning that non-OS targets use defaults', () => {
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [{
              id: 'mixed-prompt',
              targets: [
                { targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' },
                { targetType: 'GOOGLE_PLAY_SYSTEM_UPDATE' },
              ],
              outcome: { outcomeType: 'USER_PROMPT' },
            }],
          },
        }}
        onChange={vi.fn()}
      />,
    );

    expandRule();
    expect(screen.getByRole('option', { name: 'User prompt (OS targets only)' })).toBeEnabled();
    expect(screen.getByText(/User prompt applies only to the OS targets in this mixed rule/)).toBeInTheDocument();
    expect(screen.getByText(/Stage selection applies only to the OEM OS targets/)).toBeInTheDocument();
  });

  it('keeps rule-specific zero upper-age semantics beside the relevant input', () => {
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [{
              id: 'mainline',
              targets: [{ targetType: 'GOOGLE_PLAY_SYSTEM_UPDATE' }],
              predicate: { updateAgeUpperBound: '0s' },
              outcome: { outcomeType: 'BLOCK' },
            }],
          },
        }}
        onChange={vi.fn()}
      />,
    );

    expandRule();
    expect(screen.getByText('Leave blank for no maximum. Android also treats zero as no maximum.')).toBeInTheDocument();
    expect(screen.getByText(/A maximum update age of 0 means no maximum/)).toBeInTheDocument();
  });

  it('assigns a unique ID when duplicating a rule', () => {
    const onChange = vi.fn();
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [
              {
                id: 'os-rule',
                targets: [{ targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' }],
                outcome: { outcomeType: 'USER_PROMPT' },
              },
              {
                id: 'os-rule-copy',
                targets: [{ targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' }],
                outcome: { outcomeType: 'USER_PROMPT' },
              },
            ],
          },
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate rule 1' }));
    expect(onChange).toHaveBeenCalledWith(
      'unifiedUpdatePolicy.rules',
      expect.arrayContaining([expect.objectContaining({ id: 'os-rule-copy-2', _flashName: 'Os rule copy' })]),
    );
  });

  it('stores a friendly Flash-only name without changing the generated rule ID', () => {
    const onChange = vi.fn();
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [{
              id: 'stable-generated-id',
              targets: [{ targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' }],
              outcome: { outcomeType: 'BLOCK' },
            }],
          },
        }}
        onChange={onChange}
      />,
    );

    expandRule();
    fireEvent.change(screen.getByLabelText('Rule 1 name'), { target: { value: 'Delay major updates' } });
    expect(onChange).toHaveBeenCalledWith(
      'unifiedUpdatePolicy.rules',
      [expect.objectContaining({ id: 'stable-generated-id', _flashName: 'Delay major updates' })],
    );
  });

  it('uses plain-language condition labels instead of API bound terminology', () => {
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [{
              id: 'plain-language',
              targets: [{ targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' }],
              outcome: { outcomeType: 'BLOCK' },
            }],
          },
        }}
        onChange={vi.fn()}
      />,
    );

    expandRule();
    fireEvent.click(screen.getByRole('radio', { name: /Only when/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Time of day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update age' }));
    expect(screen.getByLabelText('Start time (included)')).toHaveDisplayValue('Start of day');
    expect(screen.getByLabelText('End time (not included)')).toHaveDisplayValue('End of day');
    expect(screen.getByLabelText('Rule 1 start date')).toBeInTheDocument();
    expect(screen.getByLabelText('Rule 1 end date')).toBeInTheDocument();
    expect(screen.getByLabelText('Rule 1 minimum update age')).toHaveAttribute('placeholder', 'No minimum');
    expect(screen.getByLabelText('Rule 1 maximum update age')).toHaveAttribute('placeholder', 'No maximum');
  });

  it('explains that single-app eligibility is checked by AMAPI rather than a fixed list', () => {
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [{
              id: 'single-app',
              targets: [{ targetType: 'SINGLE_APP', singleApp: { packageName: '' } }],
              outcome: { outcomeType: 'BLOCK' },
            }],
          },
        }}
        onChange={vi.fn()}
      />,
    );

    expandRule();
    expect(screen.getByText('Enter the Google system service app package name.')).toBeInTheDocument();
    expect(screen.getByText(/Google does not publish a fixed package list/)).toBeInTheDocument();
    expect(screen.getByText(/Use another rule for another app/)).toBeInTheDocument();
  });

  it('keeps existing rules collapsed and expands only one editor at a time', () => {
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [
              {
                id: 'major',
                _flashName: 'Major updates',
                targets: [{ targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' }],
                outcome: { outcomeType: 'BLOCK' },
              },
              {
                id: 'mainline',
                _flashName: 'Mainline updates',
                targets: [{ targetType: 'GOOGLE_PLAY_SYSTEM_UPDATE' }],
                outcome: { outcomeType: 'FORCE' },
              },
            ],
          },
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Rule 1 name')).not.toBeInTheDocument();
    expect(screen.getAllByText('Configuration summary:')).toHaveLength(2);
    expandRule(1);
    expect(screen.getByLabelText('Rule 1 name')).toBeInTheDocument();
    expandRule(2);
    expect(screen.queryByLabelText('Rule 1 name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rule 2 name')).toBeInTheDocument();
  });

  it('opens a newly added rule for editing', () => {
    render(<ControlledPlatformUpdatesSection initialConfig={{}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.getByRole('button', { name: 'Collapse rule 1' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Rule 1 name')).toHaveValue('Update rule 1');
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('opens a duplicated rule and preserves a stable unique ID', () => {
    render(
      <ControlledPlatformUpdatesSection
        initialConfig={{
          unifiedUpdatePolicy: {
            rules: [{
              id: 'major',
              _flashName: 'Major updates',
              targets: [{ targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' }],
              outcome: { outcomeType: 'BLOCK' },
            }],
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate rule 1' }));
    expect(screen.getByRole('button', { name: 'Collapse rule 2' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Rule 2 name')).toHaveValue('Major updates copy');
  });

  it('shows configured condition groups and clears the predicate only when Always is chosen', () => {
    const onChange = vi.fn();
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [{
              id: 'scheduled',
              targets: [{ targetType: 'OS_UPDATE_WITH_API_LEVEL_CHANGE' }],
              predicate: {
                daysOfWeek: ['MONDAY'],
                updateAgeLowerBound: '86400s',
              },
              outcome: { outcomeType: 'BLOCK' },
            }],
          },
        }}
        onChange={onChange}
      />,
    );

    expandRule();
    expect(screen.getByRole('radio', { name: /Only when/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeChecked();
    expect(screen.getByLabelText('Rule 1 minimum update age')).toHaveValue(1);
    fireEvent.click(screen.getByRole('radio', { name: /Always/ }));
    expect(onChange).toHaveBeenCalledWith(
      'unifiedUpdatePolicy.rules',
      [expect.not.objectContaining({ predicate: expect.anything() })],
    );
  });

  it('adds and removes optional condition groups without inventing predicate values', () => {
    const onChange = vi.fn();
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [{
              id: 'conditional',
              targets: [{ targetType: 'GOOGLE_PLAY_SYSTEM_UPDATE' }],
              outcome: { outcomeType: 'BLOCK' },
            }],
          },
        }}
        onChange={onChange}
      />,
    );

    expandRule();
    fireEvent.click(screen.getByRole('radio', { name: /Only when/ }));
    expect(screen.getByText(/No conditions added yet/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Days of week' }));
    expect(screen.getByRole('checkbox', { name: 'Mon' })).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mon' }));
    expect(onChange).toHaveBeenCalledWith(
      'unifiedUpdatePolicy.rules',
      [expect.objectContaining({ predicate: { daysOfWeek: ['MONDAY'] } })],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove days of week condition from rule 1' }));
    expect(onChange).toHaveBeenLastCalledWith(
      'unifiedUpdatePolicy.rules',
      [expect.not.objectContaining({ predicate: expect.anything() })],
    );
  });

  it('summarises validation and review state on collapsed cards', () => {
    render(
      <PlatformUpdatesSection
        config={{
          unifiedUpdatePolicy: {
            rules: [
              {
                id: 'incomplete',
                targets: [],
                outcome: { outcomeType: 'OUTCOME_TYPE_UNSPECIFIED' },
              },
              {
                id: 'review',
                _flashName: 'Rule needing review',
                targets: [{ targetType: 'GOOGLE_PLAY_SYSTEM_UPDATE' }],
                predicate: { updateAgeUpperBound: '0s' },
                outcome: { outcomeType: 'BLOCK' },
              },
              {
                id: 'ready',
                _flashName: 'Ready rule',
                targets: [{ targetType: 'GOOGLE_PLAY_SYSTEM_UPDATE' }],
                outcome: { outcomeType: 'FORCE' },
              },
            ],
          },
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });
});
