import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PolicyCategoryNav from '@/components/policy/PolicyCategoryNav';

describe('PolicyCategoryNav scenario visibility', () => {
  it('shows Cross-Profile for work-profile policies', () => {
    render(
      <PolicyCategoryNav
        activeCategory="crossProfile"
        onCategoryChange={vi.fn()}
        scenario="wp"
      />,
    );

    expect(screen.getByRole('button', { name: 'Cross-Profile' })).toBeInTheDocument();
  });

  it.each(['fm', 'dedicated'])('hides Cross-Profile for %s policies', (scenario) => {
    render(
      <PolicyCategoryNav
        activeCategory="deviceSettings"
        onCategoryChange={vi.fn()}
        scenario={scenario}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Cross-Profile' })).not.toBeInTheDocument();
  });

  it('shows Kiosk Mode for dedicated policies', () => {
    render(
      <PolicyCategoryNav
        activeCategory="kioskMode"
        onCategoryChange={vi.fn()}
        scenario="dedicated"
      />,
    );

    expect(screen.getByRole('button', { name: 'Kiosk Mode' })).toBeInTheDocument();
  });
});
