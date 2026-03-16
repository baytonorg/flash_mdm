import { Bot } from "lucide-react";
import { useFlashagentStore } from "@/stores/flashagent";

export default function FlashiButton() {
  const toggleChat = useFlashagentStore((s) => s.toggleChat);
  const chatOpen = useFlashagentStore((s) => s.chatOpen);

  return (
    <button
      type="button"
      onClick={toggleChat}
      aria-label={chatOpen ? "Close Flashi assistant" : "Open Flashi assistant"}
      className="fixed bottom-5 right-5 z-[55] flex h-12 w-12 items-center justify-center rounded-full bg-accent text-white shadow-lg transition-transform hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2"
    >
      <Bot className="h-6 w-6" />
    </button>
  );
}
