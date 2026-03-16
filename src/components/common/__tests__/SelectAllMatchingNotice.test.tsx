import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SelectAllMatchingNotice from '../SelectAllMatchingNotice';

describe('SelectAllMatchingNotice', () => {
  it('renders CTA when loaded rows are selected but not all matching', async () => {
    const onSelectAllMatching = vi.fn();
    const user = userEvent.setup();

    render(
      <SelectAllMatchingNotice
        loadedCount={25}
        totalCount={100}
        allMatching={false}
        canSelectAllMatching={true}
        onSelectAllMatching={onSelectAllMatching}
      />,
    );

    expect(screen.getByText('All 25 loaded rows are selected.')).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: 'Select all 100 matching' });
    await user.click(cta);
    expect(onSelectAllMatching).toHaveBeenCalledOnce();
  });

  it('renders all-matching message when allMatching=true', () => {
    render(
      <SelectAllMatchingNotice
        loadedCount={25}
        totalCount={100}
        allMatching={true}
        canSelectAllMatching={false}
        onSelectAllMatching={vi.fn()}
      />,
    );

    expect(screen.getByText('All 100 matching rows are selected.')).toBeInTheDocument();
  });

  it('renders nothing when CTA should not be shown', () => {
    const { container } = render(
      <SelectAllMatchingNotice
        loadedCount={25}
        totalCount={25}
        allMatching={false}
        canSelectAllMatching={false}
        onSelectAllMatching={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
