import { X, Download, Trash2, Bot } from "lucide-react";
import { useFlashagentStore } from "@/stores/flashagent";
import { useFlashiChat } from "@/hooks/useFlashiChat";
import FlashiMessageList from "./FlashiMessageList";
import FlashiInput from "./FlashiInput";
import { useEffect, useCallback, useRef } from "react";

export default function FlashiPanel() {
  const setChatOpen = useFlashagentStore((s) => s.setChatOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const {
    chatHistory,
    textInput,
    setTextInput,
    isChatLoading,
    chatLoadingStep,
    chatEndRef,
    submitMessage,
    clearChatHistory,
    downloadChatHistory,
    environmentId,
  } = useFlashiChat();

  // Escape key to close + focus trapping
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChatOpen(false);
        return;
      }

      // Focus trap: keep Tab cycling within the panel
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [setChatOpen],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleClear = async () => {
    if (chatHistory.length === 0 || isChatLoading) return;
    if (!window.confirm("Clear all chat history for this environment?")) return;
    await clearChatHistory();
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Flashi assistant"
      className="fixed bottom-20 right-5 z-[55] flex w-[400px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-white shadow-2xl md:h-[550px] max-md:left-2.5 max-md:right-2.5 max-md:w-auto max-md:h-[75vh]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-accent" />
          <h2 className="text-sm font-semibold text-gray-900">Flashi</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={downloadChatHistory}
            disabled={chatHistory.length === 0}
            aria-label="Download chat history"
            title="Download chat history"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={chatHistory.length === 0 || isChatLoading}
            aria-label="Clear chat history"
            title="Clear chat history"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500 disabled:opacity-30"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setChatOpen(false)}
            aria-label="Close assistant"
            title="Close (Esc)"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <FlashiMessageList
        messages={chatHistory}
        isLoading={isChatLoading}
        loadingStep={chatLoadingStep}
        chatEndRef={chatEndRef}
      />

      {/* Input */}
      <FlashiInput
        value={textInput}
        onChange={setTextInput}
        onSubmit={() => submitMessage()}
        disabled={isChatLoading || !environmentId}
        disabledReason={
          !environmentId ? "Select an environment to use Flashi." : undefined
        }
      />
    </div>
  );
}
