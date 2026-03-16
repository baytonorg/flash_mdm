import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SelectField from '../SelectField';

const options = [
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Deny' },
  { value: 'prompt', label: 'Prompt User' },
];

describe('SelectField', () => {
  it('renders the label', () => {
    render(<SelectField label="Permission" value="allow" onChange={() => {}} options={options} />);
    expect(screen.getByText('Permission')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <SelectField
        label="Permission"
        description="Choose the permission level"
        value="allow"
        onChange={() => {}}
        options={options}
      />,
    );
    expect(screen.getByText('Choose the permission level')).toBeInTheDocument();
  });

  it('renders all options', () => {
    render(<SelectField label="Permission" value="allow" onChange={() => {}} options={options} />);
    expect(screen.getByText('Allow')).toBeInTheDocument();
    expect(screen.getByText('Deny')).toBeInTheDocument();
    expect(screen.getByText('Prompt User')).toBeInTheDocument();
  });

  it('shows the current value as selected', () => {
    render(<SelectField label="Permission" value="deny" onChange={() => {}} options={options} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('deny');
  });

  it('calls onChange when selection changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SelectField label="Permission" value="allow" onChange={onChange} options={options} />);

    await user.selectOptions(screen.getByRole('combobox'), 'prompt');
    expect(onChange).toHaveBeenCalledWith('prompt');
  });
});
