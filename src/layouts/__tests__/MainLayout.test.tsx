import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useUiStore } from '@/stores/ui';

const mocks = vi.hoisted(() => ({
  licensingEnabled: true,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: { settings: { effective_licensing_enabled: mocks.licensingEnabled } },
  }),
}));

// Mock child components to keep tests focused on layout behavior
vi.mock('@/components/common/ContextSwitcher', () => ({
  default: () => <div data-testid="context-switcher">ContextSwitcher</div>,
}));

vi.mock('@/components/common/GlobalSearch', () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? <div data-testid="global-search">GlobalSearch</div> : null,
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { email: 'test@example.com', first_name: 'Test', last_name: 'User', is_superadmin: false },
    logout: vi.fn(),
    fetchSession: vi.fn(),
  }),
}));

vi.mock('@/stores/context', () => ({
  useContextStore: () => ({
    activeWorkspace: { id: 'ws_1' },
    fetchWorkspaces: vi.fn(),
  }),
}));

vi.mock('@/lib/brand', () => ({
  BRAND: { name: 'Flash MDM', shortName: 'Flash', tagline: 'MDM made simple' },
}));

// Must import MainLayout after mocks are set up
import MainLayout from '../MainLayout';

function renderLayout() {
  return render(
    <MemoryRouter>
      <MainLayout />
    </MemoryRouter>,
  );
}

describe('MainLayout', () => {
  beforeEach(() => {
    mocks.licensingEnabled = true;
    useUiStore.setState({ sidebarOpen: true });
  });

  describe('sidebar rendering', () => {
    it('renders the sidebar element', () => {
      renderLayout();
      expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    });

    it('renders navigation links', () => {
      renderLayout();
      // Each label appears twice (mobile span + desktop span), so use getAllByText
      expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Devices').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Policies').length).toBeGreaterThanOrEqual(1);
    });

    it('renders the toggle sidebar button', () => {
      renderLayout();
      expect(screen.getByLabelText('Toggle sidebar')).toBeInTheDocument();
    });

    it('hides the Licences nav item when licensing is disabled for workspace', () => {
      mocks.licensingEnabled = false;
      renderLayout();
      expect(screen.queryByText('Licences')).not.toBeInTheDocument();
    });
  });

  describe('sidebar toggle behavior', () => {
    it('toggles sidebar state when toggle button is clicked', () => {
      renderLayout();
      expect(useUiStore.getState().sidebarOpen).toBe(true);

      fireEvent.click(screen.getByLabelText('Toggle sidebar'));
      expect(useUiStore.getState().sidebarOpen).toBe(false);
    });

    it('shows backdrop overlay when sidebar is open (mobile classes present)', () => {
      useUiStore.setState({ sidebarOpen: true });
      renderLayout();
      const backdrop = screen.getByTestId('sidebar-backdrop');
      expect(backdrop).toBeInTheDocument();
      expect(backdrop.className).toContain('md:hidden');
    });

    it('does not show backdrop when sidebar is closed', () => {
      useUiStore.setState({ sidebarOpen: false });
      renderLayout();
      expect(screen.queryByTestId('sidebar-backdrop')).not.toBeInTheDocument();
    });

    it('closes sidebar when backdrop is clicked', () => {
      useUiStore.setState({ sidebarOpen: true });
      renderLayout();
      fireEvent.click(screen.getByTestId('sidebar-backdrop'));
      expect(useUiStore.getState().sidebarOpen).toBe(false);
    });

    it('closes sidebar when close button is clicked', () => {
      useUiStore.setState({ sidebarOpen: true });
      renderLayout();
      fireEvent.click(screen.getByLabelText('Close sidebar'));
      expect(useUiStore.getState().sidebarOpen).toBe(false);
    });
  });

  describe('mobile overlay classes', () => {
    it('sidebar has fixed positioning classes for mobile', () => {
      renderLayout();
      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar.className).toContain('fixed');
      expect(sidebar.className).toContain('z-50');
    });

    it('sidebar has static positioning override for desktop', () => {
      renderLayout();
      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar.className).toContain('md:static');
      expect(sidebar.className).toContain('md:z-auto');
    });

    it('sidebar translates off-screen when closed (for mobile)', () => {
      useUiStore.setState({ sidebarOpen: false });
      renderLayout();
      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar.className).toContain('-translate-x-full');
    });

    it('sidebar is visible when open', () => {
      useUiStore.setState({ sidebarOpen: true });
      renderLayout();
      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar.className).toContain('translate-x-0');
    });

    it('sidebar always translates to zero on desktop via md: prefix', () => {
      renderLayout();
      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar.className).toContain('md:translate-x-0');
    });

    it('backdrop has correct overlay classes', () => {
      useUiStore.setState({ sidebarOpen: true });
      renderLayout();
      const backdrop = screen.getByTestId('sidebar-backdrop');
      expect(backdrop.className).toContain('fixed');
      expect(backdrop.className).toContain('inset-0');
      expect(backdrop.className).toContain('z-40');
      expect(backdrop.className).toContain('md:hidden');
    });
  });

  describe('responsive content area', () => {
    it('main content has responsive padding', () => {
      renderLayout();
      const main = document.querySelector('main');
      expect(main).not.toBeNull();
      expect(main!.className).toContain('p-4');
      expect(main!.className).toContain('md:p-6');
    });

    it('header has responsive padding', () => {
      renderLayout();
      const header = document.querySelector('header');
      expect(header).not.toBeNull();
      expect(header!.className).toContain('px-4');
      expect(header!.className).toContain('md:px-6');
    });
  });
});
