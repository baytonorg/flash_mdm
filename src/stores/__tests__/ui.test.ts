import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../ui';

beforeEach(() => {
  useUiStore.setState({
    sidebarOpen: true,
    viewMode: 'table',
  });
});

describe('useUiStore', () => {
  describe('toggleSidebar', () => {
    it('flips sidebarOpen from true to false', () => {
      expect(useUiStore.getState().sidebarOpen).toBe(true);
      useUiStore.getState().toggleSidebar();
      expect(useUiStore.getState().sidebarOpen).toBe(false);
    });

    it('flips sidebarOpen from false to true', () => {
      useUiStore.setState({ sidebarOpen: false });
      useUiStore.getState().toggleSidebar();
      expect(useUiStore.getState().sidebarOpen).toBe(true);
    });

    it('toggles multiple times correctly', () => {
      useUiStore.getState().toggleSidebar(); // true -> false
      useUiStore.getState().toggleSidebar(); // false -> true
      useUiStore.getState().toggleSidebar(); // true -> false
      expect(useUiStore.getState().sidebarOpen).toBe(false);
    });
  });

  describe('setSidebarOpen', () => {
    it('sets sidebarOpen to true', () => {
      useUiStore.setState({ sidebarOpen: false });
      useUiStore.getState().setSidebarOpen(true);
      expect(useUiStore.getState().sidebarOpen).toBe(true);
    });

    it('sets sidebarOpen to false', () => {
      useUiStore.getState().setSidebarOpen(false);
      expect(useUiStore.getState().sidebarOpen).toBe(false);
    });
  });

  describe('setViewMode', () => {
    it('updates viewMode to card', () => {
      useUiStore.getState().setViewMode('card');
      expect(useUiStore.getState().viewMode).toBe('card');
    });

    it('updates viewMode to table', () => {
      useUiStore.setState({ viewMode: 'card' });
      useUiStore.getState().setViewMode('table');
      expect(useUiStore.getState().viewMode).toBe('table');
    });
  });

  describe('default state', () => {
    it('starts with sidebarOpen=true', () => {
      // Reset to truly default state
      useUiStore.setState({ sidebarOpen: true });
      expect(useUiStore.getState().sidebarOpen).toBe(true);
    });

    it('starts with viewMode=table', () => {
      useUiStore.setState({ viewMode: 'table' });
      expect(useUiStore.getState().viewMode).toBe('table');
    });
  });
});
