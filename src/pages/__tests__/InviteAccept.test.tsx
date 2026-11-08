import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(),
  },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: null,
    isLoading: false,
    logout: vi.fn(),
  }),
}));

import InviteAccept from '@/pages/InviteAccept';

describe('InviteAccept', () => {
  it('marks invitation loading and result states as non-indexable while mounted', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/invite/synthetic']}>
        <Routes>
          <Route path="/invite/:token" element={<InviteAccept />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow, noarchive',
    );
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).not.toBeInTheDocument();
  });
});
