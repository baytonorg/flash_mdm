import { create } from "zustand";

const FLASHI_CHAT_OPEN_STORAGE_KEY = "flashi_chat_open";

function loadChatOpen(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(FLASHI_CHAT_OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveChatOpen(open: boolean): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(FLASHI_CHAT_OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // ignore storage errors
  }
}

interface FlashagentState {
  chatOpen: boolean;
  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;
  reset: () => void;
}

export const useFlashagentStore = create<FlashagentState>((set) => ({
  chatOpen: loadChatOpen(),
  toggleChat: () =>
    set((state) => {
      const next = !state.chatOpen;
      saveChatOpen(next);
      return { chatOpen: next };
    }),
  setChatOpen: (open) =>
    set(() => {
      saveChatOpen(open);
      return { chatOpen: open };
    }),
  reset: () =>
    set(() => {
      saveChatOpen(false);
      return { chatOpen: false };
    }),
}));
