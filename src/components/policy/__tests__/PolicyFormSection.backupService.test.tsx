import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PolicyFormSection from '@/components/policy/PolicyFormSection';

describe('PolicyFormSection backup service', () => {
  it('shows the disabled default without modifying an existing policy', () => {
    const onChange = vi.fn();
    render(<PolicyFormSection category="security" config={{}} onChange={onChange} />);

    expect(screen.getByRole('radio', { name: 'Unspecified (disabled by default)' })).toBeChecked();
    expect(screen.getByText(/fully managed devices running Android 8 or later/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each([
    ['BACKUP_SERVICE_UNSPECIFIED', 'Unspecified (disabled by default)'],
    ['BACKUP_SERVICE_DISABLED', 'Disabled Backups are disabled and the user cannot change this setting.'],
    ['BACKUP_SERVICE_USER_CHOICE', 'User choice The user can enable or disable the backup service.'],
  ])('reads and writes %s at the top-level AMAPI key', (value, label) => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PolicyFormSection category="security" config={{ backupService: value }} onChange={onChange} />,
    );
    expect(screen.getByRole('radio', { name: label })).toBeChecked();

    rerender(<PolicyFormSection category="security" config={{ backupService: 'OTHER' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: label }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('backupService', value);
  });
});
