/**
 * Flashi chat hook — manages message state, submission, history persistence.
 * Adapted from MCP-POC useAssistantChat.ts, simplified for Flash MDM.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useContextStore } from "@/stores/context";
import { apiClient } from "@/api/client";
import { buildFlashiProgressPlan } from "@/utils/flashiProgress";

export interface FlashiMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  source?: "none" | "mcp" | "api" | "mixed";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CONTEXT_MESSAGE_WINDOW = 10;
const CONTEXT_MESSAGE_MAX_CHARS = 1000;
const MAX_USER_MESSAGE_CHARS = 12_000;
const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/** Map internal error messages to user-friendly text */
function friendlyErrorMessage(err: Error): string {
  const msg = err?.message || "";
  if (msg.includes("401") || msg.includes("Unauthorized"))
    return "Your session has expired. Please log in again.";
  if (msg.includes("403") || msg.includes("Forbidden"))
    return "You do not have permission to use Flashi in this environment.";
  if (msg.includes("429"))
    return "Too many requests. Please wait a moment and try again.";
  if (msg.includes("500") || msg.includes("Internal"))
    return "Something went wrong on our end. Please try again.";
  // Don't leak detailed backend errors — return generic message
  if (msg.length > 200 || msg.includes("OpenAI") || msg.includes("SQL")) {
    return "Something went wrong. Please try again.";
  }
  return msg || "Something went wrong. Please try again.";
}

export function useFlashiChat() {
  const [chatHistory, setChatHistory] = useState<FlashiMessage[]>([]);
  const [textInput, setTextInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const isChatLoadingRef = useRef(false);
  const [chatLoadingStep, setChatLoadingStep] = useState(
    "Analysing your request...",
  );
  const chatEndRef = useRef<HTMLDivElement>(null);
  const previousChatHistoryRef = useRef<FlashiMessage[]>([]);
  const skipNextPersistRef = useRef(false);
  const chatHistoryHydratedRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const progressCleanupRef = useRef<(() => void) | null>(null);
  const chatHistoryRef = useRef<FlashiMessage[]>([]);

  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const environmentId = activeEnvironment?.id || "";

  // Keep a ref in sync with state for use in callbacks (avoids stale closures)
  useEffect(() => {
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

  // --- Normalisation ---
  const normalizeIncomingMessage = (entry: any): FlashiMessage | null => {
    const roleRaw = String(entry?.role || "")
      .trim()
      .toLowerCase();
    const role: FlashiMessage["role"] =
      roleRaw === "user" ? "user" : "assistant";
    const text = String(entry?.text || "").trim();
    if (!text) return null;
    const ts = entry?.created_at
      ? new Date(entry.created_at).getTime()
      : Date.now();
    return {
      role,
      text,
      timestamp: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    };
  };

  const normalizeIncomingHistory = (entries: any[]): FlashiMessage[] => {
    if (!Array.isArray(entries)) return [];
    const result: FlashiMessage[] = [];
    for (const entry of entries) {
      const msg = normalizeIncomingMessage(entry);
      if (msg) result.push(msg);
    }
    return result.sort((a, b) => a.timestamp - b.timestamp);
  };

  // --- Auto-scroll ---
  useEffect(() => {
    const el = chatEndRef.current;
    if (!el) return;
    const raf = window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [chatHistory, isChatLoading, chatLoadingStep]);

  // --- Cleanup progress interval on unmount ---
  useEffect(() => {
    return () => {
      progressCleanupRef.current?.();
    };
  }, []);

  // --- History hydration ---
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (!environmentId) {
        chatHistoryHydratedRef.current = true;
        skipNextPersistRef.current = true;
        previousChatHistoryRef.current = [];
        setChatHistory([]);
        return;
      }

      chatHistoryHydratedRef.current = false;
      try {
        const data = await apiClient.get<{ messages: any[] }>(
          `/api/flashagent/chat-history?environment_id=${encodeURIComponent(environmentId)}`,
        );
        if (cancelled) return;
        const loaded = normalizeIncomingHistory(data?.messages || []);
        skipNextPersistRef.current = true;
        previousChatHistoryRef.current = loaded;
        setChatHistory(loaded);
      } catch {
        if (cancelled) return;
        skipNextPersistRef.current = true;
        previousChatHistoryRef.current = [];
        setChatHistory([]);
      } finally {
        if (!cancelled) chatHistoryHydratedRef.current = true;
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  // --- Persist new messages ---
  const persistMessages = useCallback(
    async (messages: FlashiMessage[]) => {
      if (!environmentId || messages.length === 0) return;
      const payload = messages.map((m) => ({
        role: m.role,
        text: String(m.text).slice(0, 8_000),
      }));
      try {
        await apiClient.post("/api/flashagent/chat-history", {
          environment_id: environmentId,
          messages: payload,
        });
      } catch {
        console.warn("Flashi: Failed to persist chat messages");
      }
    },
    [environmentId],
  );

  const queuePersist = useCallback(
    (messages: FlashiMessage[]) => {
      persistQueueRef.current = persistQueueRef.current
        .catch(() => {})
        .then(() => persistMessages(messages));
    },
    [persistMessages],
  );

  // Detect appended messages and persist
  useEffect(() => {
    if (!environmentId || !chatHistoryHydratedRef.current) {
      previousChatHistoryRef.current = chatHistory;
      return;
    }
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      previousChatHistoryRef.current = chatHistory;
      return;
    }

    const prev = previousChatHistoryRef.current;
    const next = chatHistory;
    if (next.length > prev.length) {
      const appended = next.slice(prev.length);
      if (appended.length > 0) {
        void queuePersist(appended);
      }
    }
    previousChatHistoryRef.current = next;
  }, [chatHistory, environmentId, queuePersist]);

  // --- Progress step cycling ---
  const runProgressSteps = useCallback((message: string) => {
    const steps = buildFlashiProgressPlan(message);
    let i = 0;
    setChatLoadingStep(steps[0] || "Analysing your request...");

    const interval = setInterval(() => {
      i += 1;
      if (i < steps.length) {
        setChatLoadingStep(steps[i]);
      }
    }, 3000);

    const cleanup = () => clearInterval(interval);
    progressCleanupRef.current = cleanup;
    return cleanup;
  }, []);

  // --- Submit message ---
  const submitMessage = useCallback(
    async (text?: string) => {
      const message = (text ?? textInput)
        .trim()
        .slice(0, MAX_USER_MESSAGE_CHARS);
      if (!message || isChatLoadingRef.current || !environmentId) return;

      // Capture the environment ID at submission time for staleness check
      const submissionEnvId = environmentId;

      setTextInput("");
      setIsChatLoading(true);
      isChatLoadingRef.current = true;

      const userMsg: FlashiMessage = {
        role: "user",
        text: message,
        timestamp: Date.now(),
      };
      setChatHistory((prev) => [...prev, userMsg]);

      const stopProgress = runProgressSteps(message);

      // Build context messages from ref (avoids stale closure)
      const contextMessages = chatHistoryRef.current
        .slice(-CONTEXT_MESSAGE_WINDOW)
        .map((m) => ({
          role: m.role,
          text: String(m.text).slice(0, CONTEXT_MESSAGE_MAX_CHARS),
        }));

      let lastError: Error | null = null;
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const data = await apiClient.post<{
            reply: string;
            role: string;
            source?: "none" | "mcp" | "api" | "mixed";
          }>(
            "/api/flashagent/chat",
            {
              message,
              environment_id: submissionEnvId,
              contextMessages,
            },
          );

          // Check if environment switched while we were waiting
          const currentEnvId =
            useContextStore.getState().activeEnvironment?.id || "";
          if (currentEnvId !== submissionEnvId) {
            // Environment changed — discard the response
            stopProgress();
            progressCleanupRef.current = null;
            isChatLoadingRef.current = false;
            setIsChatLoading(false);
            return;
          }

          const replyText = data?.reply || "No response received.";
          const assistantMsg: FlashiMessage = {
            role: "assistant",
            text: replyText,
            timestamp: Date.now(),
            source: data?.source,
          };
          setChatHistory((prev) => [...prev, assistantMsg]);
          stopProgress();
          progressCleanupRef.current = null;
          isChatLoadingRef.current = false;
          setIsChatLoading(false);
          return;
        } catch (err: any) {
          const currentEnvId =
            useContextStore.getState().activeEnvironment?.id || "";
          if (currentEnvId !== submissionEnvId) {
            stopProgress();
            progressCleanupRef.current = null;
            isChatLoadingRef.current = false;
            setIsChatLoading(false);
            return;
          }

          lastError = err instanceof Error ? err : new Error(String(err));
          const status = err?.status || 0;
          if (!TRANSIENT_HTTP_STATUSES.has(status) || attempt === maxAttempts) {
            break;
          }
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
          setChatLoadingStep(
            `Retrying (attempt ${attempt + 1}/${maxAttempts})...`,
          );
          await sleep(delay);
        }
      }

      // Error case
      stopProgress();
      progressCleanupRef.current = null;
      const currentEnvId = useContextStore.getState().activeEnvironment?.id || "";
      if (currentEnvId !== submissionEnvId) {
        isChatLoadingRef.current = false;
        setIsChatLoading(false);
        return;
      }
      const errorText = friendlyErrorMessage(
        lastError || new Error("Unknown error"),
      );
      const errorMsg: FlashiMessage = {
        role: "assistant",
        text: `⚠️ ${errorText}`,
        timestamp: Date.now(),
      };
      setChatHistory((prev) => [...prev, errorMsg]);
      isChatLoadingRef.current = false;
      setIsChatLoading(false);
    },
    [textInput, environmentId, runProgressSteps],
  );

  // --- Clear history ---
  const clearChatHistory = useCallback(async () => {
    if (!environmentId) return;
    try {
      await apiClient.delete(
        `/api/flashagent/chat-history?environment_id=${encodeURIComponent(environmentId)}`,
      );
      // Only clear local state on successful server deletion
      skipNextPersistRef.current = true;
      previousChatHistoryRef.current = [];
      setChatHistory([]);
    } catch {
      console.warn("Flashi: Failed to clear chat history");
    }
  }, [environmentId]);

  // --- Download history ---
  const downloadChatHistory = useCallback(async () => {
    if (!environmentId) return;
    try {
      const data = await apiClient.get<{ markdown: string }>(
        `/api/flashagent/chat-history?environment_id=${encodeURIComponent(environmentId)}&format=markdown`,
      );
      if (!data?.markdown) return;
      const blob = new Blob([data.markdown], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `flashi-chat-${new Date().toISOString().slice(0, 10)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      console.warn("Flashi: Failed to download chat history");
    }
  }, [environmentId]);

  return {
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
  };
}
