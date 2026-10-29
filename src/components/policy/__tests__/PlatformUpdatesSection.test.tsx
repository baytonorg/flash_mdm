import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import PlatformUpdatesSection from '@/components/policy/PlatformUpdatesSection';

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
    expect(screen.getByText('Which control should I use?')).toBeInTheDocument();
    expect(screen.getByText(/Using both is valid/)).toHaveTextContent('the controls are not combined');
    expect(screen.getByText(/Using both is valid/)).toHaveTextContent('System update policy controls OEM updates, including security-patch level updates.');
    expect(screen.getByText(/Using both is valid/)).toHaveTextContent('UUC rules for OEM updates have no effect until System update policy is cleared.');
    const majorRow = screen.getAllByText('Major OS updates')[0]?.closest<HTMLElement>('div[class*="grid"]');
    const mainlineRow = screen.getAllByText('Google Play system updates')[0]?.closest<HTMLElement>('div[class*="grid"]');
    expect(majorRow).not.toBeNull();
    expect(mainlineRow).not.toBeNull();
    expect(within(majorRow!).getByText('System update policy')).toBeInTheDocument();
    expect(within(mainlineRow!).getByText('Unified update controls')).toBeInTheDocument();
    expect(screen.getByText('At least one UUC rule is partly or fully shadowed.')).toBeInTheDocument();
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

  it('requires confirmation before clearing System update policy', () => {
    const onChange = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(
      <PlatformUpdatesSection
        config={{ systemUpdate: { type: 'AUTOMATIC' } }}
        onChange={onChange}
      />,
    );

    const clearButton = screen.getByRole('button', { name: 'Clear System update policy' });
    fireEvent.click(clearButton);
    expect(onChange).not.toHaveBeenCalledWith('systemUpdate', undefined);

    fireEvent.click(clearButton);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenCalledWith('systemUpdate', undefined);
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

    expect(screen.getByRole('checkbox', { name: 'Download' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'User prompt (OS targets only)' })).toBeDisabled();
    expect(screen.getByLabelText('Rule 1 name')).toHaveAttribute('maxlength', '120');
    expect(screen.getByText('Configuration summary')).toBeInTheDocument();
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

    expect(screen.getByRole('checkbox', { name: 'Download' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Apply' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'User prompt (OS targets only)' })).toBeEnabled();
    expect(screen.getByText('Conditions (all must match)')).toBeInTheDocument();
    expect(screen.getByText('Leave all conditions blank to apply this rule at all times.')).toBeInTheDocument();
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

    expect(screen.getByRole('option', { name: 'User prompt (OS targets only)' })).toBeEnabled();
    expect(screen.getByText(/User prompt applies only to the OS targets in this mixed rule/)).toBeInTheDocument();
  });

  it('discloses UUC operational limits and zero upper-age semantics', () => {
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

    expect(screen.getByText(/Mainline is controlled as one update/)).toBeInTheDocument();
    expect(screen.getByText(/Google Play Store and Android Device Policy updates are exempt/)).toBeInTheDocument();
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

    expect(screen.getByText('Enter the Google system service app package name.')).toBeInTheDocument();
    expect(screen.getByText(/Google does not publish a fixed package list/)).toBeInTheDocument();
    expect(screen.getByText(/Use another rule for another app/)).toBeInTheDocument();
  });
});
