import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import PolicyFormSection from '@/components/policy/PolicyFormSection';

function field(label: string) {
  const element = screen.getByText(label).parentElement;
  expect(element).not.toBeNull();
  return within(element!);
}

describe('PolicyFormSection NFC controls', () => {
  it('places the fully managed control with device restrictions', () => {
    const onChange = vi.fn();
    render(
      <PolicyFormSection
        category="deviceSettings"
        config={{
          deviceRadioState: { nfc: 'NFC_DISABLED' },
        }}
        onChange={onChange}
      />,
    );

    const fullyManaged = field('NFC');
    expect(fullyManaged.getByRole('radio', { name: 'Disabled' })).toBeChecked();
    expect(screen.queryByText('Device-Wide NFC')).not.toBeInTheDocument();

    fireEvent.click(fullyManaged.getByRole('radio', { name: 'User Choice' }));
    expect(onChange).toHaveBeenCalledWith('deviceRadioState.nfc', 'NFC_USER_CHOICE');
  });

  it('places the company-owned work-profile control in Personal Usage', () => {
    const onChange = vi.fn();
    render(
      <PolicyFormSection
        category="personalUsage"
        config={{ deviceWidePolicies: { deviceRadioState: { nfc: 'NFC_USER_CHOICE' } } }}
        onChange={onChange}
      />,
    );

    const workProfile = field('Device-Wide NFC');
    expect(screen.getByRole('heading', { name: 'Personal Usage' })).toBeInTheDocument();
    expect(workProfile.getByRole('radio', { name: 'User Choice' })).toBeChecked();
    expect(screen.queryByText('NFC', { selector: 'label' })).not.toBeInTheDocument();

    fireEvent.click(workProfile.getByRole('radio', { name: 'Disabled' }));
    expect(onChange).toHaveBeenCalledWith('deviceWidePolicies.deviceRadioState.nfc', 'NFC_DISABLED');
  });

  it('defaults both category controls to user choice without mutating the policy', () => {
    const restrictionsChange = vi.fn();
    const { unmount } = render(<PolicyFormSection category="deviceSettings" config={{}} onChange={restrictionsChange} />);

    expect(field('NFC').getByRole('radio', { name: 'Unspecified (User Choice)' })).toBeChecked();
    expect(restrictionsChange).not.toHaveBeenCalled();
    unmount();

    const personalUsageChange = vi.fn();
    render(<PolicyFormSection category="personalUsage" config={{}} onChange={personalUsageChange} />);
    expect(field('Device-Wide NFC').getByRole('radio', { name: 'Unspecified (User Choice)' })).toBeChecked();
    expect(personalUsageChange).not.toHaveBeenCalled();
  });
});
