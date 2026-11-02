import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import PolicyFormSection from '@/components/policy/PolicyFormSection';

function field(label: string) {
  const element = screen.getByText(label).parentElement;
  expect(element).not.toBeNull();
  return within(element!);
}

describe('PolicyFormSection NFC controls', () => {
  it('keeps fully managed and company-owned work-profile paths distinct', () => {
    const onChange = vi.fn();
    render(
      <PolicyFormSection
        category="network"
        config={{
          deviceRadioState: { nfc: 'NFC_DISABLED' },
          deviceWidePolicies: { deviceRadioState: { nfc: 'NFC_USER_CHOICE' } },
        }}
        onChange={onChange}
      />,
    );

    const fullyManaged = field('Radio: NFC (Fully Managed)');
    const workProfile = field('Device-Wide Radio: NFC (Company-Owned Work Profile)');

    expect(fullyManaged.getByRole('radio', { name: 'Disabled' })).toBeChecked();
    expect(workProfile.getByRole('radio', { name: 'User Choice' })).toBeChecked();

    fireEvent.click(fullyManaged.getByRole('radio', { name: 'User Choice' }));
    fireEvent.click(workProfile.getByRole('radio', { name: 'Disabled' }));

    expect(onChange).toHaveBeenNthCalledWith(1, 'deviceRadioState.nfc', 'NFC_USER_CHOICE');
    expect(onChange).toHaveBeenNthCalledWith(2, 'deviceWidePolicies.deviceRadioState.nfc', 'NFC_DISABLED');
  });

  it('defaults both controls to user choice without mutating the policy', () => {
    const onChange = vi.fn();
    render(<PolicyFormSection category="network" config={{}} onChange={onChange} />);

    expect(field('Radio: NFC (Fully Managed)').getByRole('radio', { name: 'Unspecified (User Choice)' })).toBeChecked();
    expect(field('Device-Wide Radio: NFC (Company-Owned Work Profile)').getByRole('radio', { name: 'Unspecified (User Choice)' })).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });
});
