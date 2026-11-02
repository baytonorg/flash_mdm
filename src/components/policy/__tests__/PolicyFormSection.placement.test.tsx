import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PolicyFormSection from '@/components/policy/PolicyFormSection';

function renderCategory(category: string) {
  return render(<PolicyFormSection category={category} config={{}} onChange={vi.fn()} />);
}

describe('PolicyFormSection category placement', () => {
  it('places automatic date and time under Device Settings rather than Network', () => {
    const { unmount } = renderCategory('deviceSettings');
    expect(screen.getByText('Auto Date/Time/Zone')).toBeInTheDocument();
    unmount();

    renderCategory('network');
    expect(screen.queryByText('Auto Date/Time/Zone')).not.toBeInTheDocument();
  });

  it('places enterprise display-name visibility under Device Settings rather than Advanced', () => {
    const { unmount } = renderCategory('deviceSettings');
    expect(screen.getByText('Enterprise Display Name Visibility')).toBeInTheDocument();
    unmount();

    renderCategory('advanced');
    expect(screen.queryByText('Enterprise Display Name Visibility')).not.toBeInTheDocument();
  });

  it('separates device account restrictions from personal-profile restrictions', () => {
    const { unmount } = renderCategory('security');
    expect(screen.getByText('Account Types With Management Disabled')).toBeInTheDocument();
    expect(screen.queryByText('Personal Account Types With Management Disabled')).not.toBeInTheDocument();
    unmount();

    renderCategory('personalUsage');
    expect(screen.getByText('Personal Account Types With Management Disabled')).toBeInTheDocument();
    expect(screen.queryByText('Account Types With Management Disabled')).not.toBeInTheDocument();
  });

  it('places persistent intent handlers under Applications rather than Advanced', () => {
    const { unmount } = renderCategory('applications');
    expect(screen.getByText('Persistent Preferred Activities')).toBeInTheDocument();
    unmount();

    renderCategory('advanced');
    expect(screen.queryByText('Persistent Preferred Activities')).not.toBeInTheDocument();
  });
});
