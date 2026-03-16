import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ManagedConfigEditor from '@/components/apps/ManagedConfigEditor';

describe('ManagedConfigEditor', () => {
  it('does not render HIDDEN properties, including nested hidden properties', () => {
    render(
      <ManagedConfigEditor
        schema={[
          { key: 'visible', type: 'STRING', title: 'Visible field' },
          { key: 'secret', type: 'HIDDEN', title: 'Hidden field' },
          {
            key: 'contact',
            type: 'BUNDLE',
            title: 'Contact',
            nestedProperties: [
              { key: 'name', type: 'STRING', title: 'Name' },
              { key: 'token', type: 'HIDDEN', title: 'Hidden token' },
            ],
          },
        ]}
        value={{}}
        onChange={() => {}}
      />
    );

    expect(screen.getByText('Visible field')).toBeInTheDocument();
    expect(screen.getByText('Contact')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.queryByText('Hidden field')).not.toBeInTheDocument();
    expect(screen.queryByText('Hidden token')).not.toBeInTheDocument();
  });

  it('serializes BUNDLE_ARRAY properties as an array of bundle objects', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function Harness() {
      const [value, setValue] = useState<Record<string, unknown>>({});
      return (
        <ManagedConfigEditor
          schema={[
            {
              key: 'servers',
              type: 'BUNDLE_ARRAY',
              title: 'Servers',
              nestedProperties: [
                { key: 'host', type: 'STRING', title: 'Host' },
                { key: 'port', type: 'INTEGER', title: 'Port' },
              ],
            },
          ]}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /add item/i }));
    expect(onChange).toHaveBeenLastCalledWith({ servers: [{}] });

    await user.type(screen.getByRole('textbox'), 'api.example.com');
    expect(onChange).toHaveBeenLastCalledWith({
      servers: [{ host: 'api.example.com' }],
    });

    const portInput = screen.getByRole('spinbutton');
    await user.clear(portInput);
    await user.type(portInput, '443');
    expect(onChange).toHaveBeenLastCalledWith({
      servers: [{ host: 'api.example.com', port: 443 }],
    });
  });
});
