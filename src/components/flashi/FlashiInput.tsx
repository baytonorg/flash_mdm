import { SendHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

interface FlashiInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

export default function FlashiInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  disabledReason,
}: FlashiInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (disabled) return;
    textareaRef.current?.focus();
  }, [disabled]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) {
        onSubmit();
      }
    }
  };

  return (
    <div className="border-t border-border bg-surface p-3">
      {disabledReason && (
        <p className="mb-2 text-xs text-amber-600">{disabledReason}</p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          aria-label="Message to Flashi"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={
            disabled
              ? "Flashi is unavailable"
              : "Ask Flashi anything about your devices..."
          }
          maxLength={12000}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ maxHeight: "6rem" }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
          }}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          aria-label="Send message"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
