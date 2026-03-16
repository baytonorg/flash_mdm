import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EnumField from '../EnumField';

const fewOptions = [
  { value: 'low', label: 'Low', description: 'Minimal restrictions' },
  { value: 'medium', label: 'Medium', description: 'Moderate restrictions' },
  { value: 'high', label: 'High', description: 'Maximum restrictions' },
];

const manyOptions = Array.from({ length: 8 }, (_, i) => ({
  value: `option-${i}`,
  label: `Option ${i}`,
}));

describe('EnumField', () => {
  describe('with few options (radio buttons)', () => {
    it('renders the label', () => {
      render(<EnumField label="Security Level" value="low" onChange={() => {}} options={fewOptions} />);
      expect(screen.getByText('Security Level')).toBeInTheDocument();
    });

    it('renders description when provided', () => {
      render(
        <EnumField
          label="Security Level"
          description="Choose security level"
          value="low"
          onChange={() => {}}
          options={fewOptions}
        />,
      );
      expect(screen.getByText('Choose security level')).toBeInTheDocument();
    });

    it('renders radio buttons for <= 5 options', () => {
      render(<EnumField label="Level" value="low" onChange={() => {}} options={fewOptions} />);
      const radios = screen.getAllByRole('radio');
      expect(radios.length).toBe(3);
    });

    it('shows all option labels', () => {
      render(<EnumField label="Level" value="low" onChange={() => {}} options={fewOptions} />);
      expect(screen.getByText('Low')).toBeInTheDocument();
      expect(screen.getByText('Medium')).toBeInTheDocument();
      expect(screen.getByText('High')).toBeInTheDocument();
    });

    it('shows option descriptions', () => {
      render(<EnumField label="Level" value="low" onChange={() => {}} options={fewOptions} />);
      expect(screen.getByText('Minimal restrictions')).toBeInTheDocument();
    });

    it('checks the current value', () => {
      render(<EnumField label="Level" value="medium" onChange={() => {}} options={fewOptions} />);
      const radios = screen.getAllByRole('radio') as HTMLInputElement[];
      const medium = radios.find((r) => r.value === 'medium');
      expect(medium?.checked).toBe(true);
    });

    it('calls onChange when a radio is selected', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<EnumField label="Level" value="low" onChange={onChange} options={fewOptions} />);

      await user.click(screen.getByText('High'));
      expect(onChange).toHaveBeenCalledWith('high');
    });
  });

  describe('with many options (select dropdown)', () => {
    it('renders a select for > 5 options', () => {
      render(<EnumField label="Choose" value="option-0" onChange={() => {}} options={manyOptions} />);
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('renders all options in the select', () => {
      render(<EnumField label="Choose" value="option-0" onChange={() => {}} options={manyOptions} />);
      const selectOptions = screen.getAllByRole('option');
      expect(selectOptions.length).toBe(8);
    });

    it('calls onChange when select changes', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<EnumField label="Choose" value="option-0" onChange={onChange} options={manyOptions} />);

      await user.selectOptions(screen.getByRole('combobox'), 'option-3');
      expect(onChange).toHaveBeenCalledWith('option-3');
    });
  });
});
