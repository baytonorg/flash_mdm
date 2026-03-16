import { create } from 'zustand';

type ViewMode = 'table' | 'card';

interface UiState {
  sidebarOpen: boolean;
  viewMode: ViewMode;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  reset: () => void;
}

const initialUiState = {
  sidebarOpen: true,
  viewMode: 'table',
} satisfies Pick<UiState, 'sidebarOpen' | 'viewMode'>;

export const useUiStore = create<UiState>((set) => ({
  ...initialUiState,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setViewMode: (mode) => set({ viewMode: mode }),
  reset: () => set({ ...initialUiState }),
}));
