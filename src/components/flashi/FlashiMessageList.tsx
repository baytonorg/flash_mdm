import { Loader2 } from "lucide-react";
import DOMPurify from "dompurify";
import type { FlashiMessage } from "@/hooks/useFlashiChat";
import type { RefObject } from "react";

interface FlashiMessageListProps {
  messages: FlashiMessage[];
  isLoading: boolean;
  loadingStep: string;
  chatEndRef: RefObject<HTMLDivElement | null>;
}

/**
 * Detect if text contains markdown-style lists or formatting.
 */
function containsMarkdown(text: string): boolean {
  return /^[\s]*[-*•]\s|^[\s]*\d+\.\s|^#{1,6}\s|\*\*|__|\[.*\]\(.*\)|```/m.test(
    text,
  );
}

/**
 * Escape HTML entities to prevent XSS.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Validate that a URL is safe for use in href attributes.
 * Only allows http:// and https:// protocols.
 */
function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed);
}

/**
 * Generate a random placeholder string that cannot appear in user/LLM content.
 */
function randomPlaceholder(): string {
  return `__CB_${crypto.randomUUID().replace(/-/g, "")}_CB__`;
}

/**
 * Simple markdown-to-HTML renderer for assistant messages.
 * HTML-escapes all input first to prevent XSS, then applies markdown transforms.
 * Final output is sanitised by DOMPurify as defence-in-depth.
 * Handles: bold, inline code, code blocks, lists, links, headings.
 */
function renderMarkdown(text: string): string {
  // First: extract code blocks with cryptographically random placeholders
  const codeBlocks = new Map<string, string>();
  let escaped = text.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, _lang, code) => {
      const placeholder = randomPlaceholder();
      codeBlocks.set(placeholder, escapeHtml(code));
      return placeholder;
    },
  );

  // Escape HTML in the remaining text
  escaped = escapeHtml(escaped);

  // Re-insert code blocks (already escaped)
  for (const [placeholder, code] of codeBlocks) {
    escaped = escaped.replace(
      placeholder,
      `<pre class="bg-gray-100 rounded p-2 text-xs overflow-x-auto my-1"><code>${code}</code></pre>`,
    );
  }

  let html = escaped
    // Headings
    .replace(
      /^### (.+)$/gm,
      '<h4 class="font-semibold text-sm mt-2 mb-1">$1</h4>',
    )
    .replace(
      /^## (.+)$/gm,
      '<h3 class="font-semibold text-sm mt-2 mb-1">$1</h3>',
    )
    .replace(/^# (.+)$/gm, '<h2 class="font-bold text-base mt-2 mb-1">$1</h2>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Inline code
    .replace(
      /`([^`]+)`/g,
      '<code class="bg-gray-100 px-1 rounded text-xs">$1</code>',
    )
    // Links — only allow safe URLs (http/https)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
      const decodedUrl = url.replace(/&amp;/g, "&");
      if (isSafeUrl(decodedUrl)) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-accent underline">${label}</a>`;
      }
      return `${label} (${url})`;
    })
    // Unordered lists
    .replace(/^[\s]*[-*•]\s+(.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Ordered lists
    .replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p class="mt-1.5">')
    // Single newlines (outside of pre blocks)
    .replace(/\n/g, "<br/>");

  // Wrap consecutive <li> in <ul> or <ol>
  html = html.replace(
    /((?:<li class="ml-4 list-disc">.*?<\/li>\s*)+)/g,
    '<ul class="my-0.5">$1</ul>',
  );
  html = html.replace(
    /((?:<li class="ml-4 list-decimal">.*?<\/li>\s*)+)/g,
    '<ol class="my-0.5">$1</ol>',
  );

  // Remove paragraph wrappers accidentally introduced around list blocks.
  html = html
    .replace(
      /<p class="mt-1\.5">\s*(<(?:ul|ol)\b[\s\S]*?<\/(?:ul|ol)>)\s*<\/p>/g,
      "$1",
    )
    .replace(/<br\/>\s*(<(?:ul|ol)\b)/g, "$1")
    .replace(/(<\/(?:ul|ol)>)\s*<br\/>/g, "$1");

  // Defence-in-depth: sanitise final output with DOMPurify
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "h2",
      "h3",
      "h4",
      "strong",
      "code",
      "pre",
      "a",
      "ul",
      "ol",
      "li",
      "p",
      "br",
      "span",
    ],
    ALLOWED_ATTR: ["class", "href", "target", "rel", "style"],
    ALLOW_DATA_ATTR: false,
  });
}

function MessageBubble({ message }: { message: FlashiMessage }) {
  const isUser = message.role === "user";
  const isError = !isUser && message.text.startsWith("⚠️");
  const sourceDotClass =
    message.source === "mcp"
      ? "bg-gray-300"
      : message.source === "api"
        ? "bg-blue-300"
        : message.source === "mixed"
          ? "bg-teal-300"
          : null;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm text-white break-words [overflow-wrap:anywhere]">
          {message.text}
        </div>
      </div>
    );
  }

  const hasMarkdown = containsMarkdown(message.text);

  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[85%] rounded-2xl rounded-bl-md px-3.5 py-2 text-sm break-words [overflow-wrap:anywhere] ${
          isError ? "bg-amber-50 text-amber-800" : "bg-gray-100 text-gray-900"
        }`}
      >
        {!isError && sourceDotClass && (
          <span
            aria-hidden="true"
            className={`mb-1 ml-auto block h-1 w-1 rounded-full ${sourceDotClass}`}
          />
        )}
        {hasMarkdown ? (
          <div
            className="prose prose-sm max-w-none break-words [overflow-wrap:anywhere] [&_p]:my-0 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_li]:my-0"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
          />
        ) : (
          <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

export default function FlashiMessageList({
  messages,
  isLoading,
  loadingStep,
  chatEndRef,
}: FlashiMessageListProps) {
  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
      className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
    >
      {messages.length === 0 && !isLoading && (
        <div className="flex h-full items-center justify-center">
          <p className="text-center text-sm text-gray-400">
            Ask Flashi anything about your devices, policies, or groups.
          </p>
        </div>
      )}

      {messages.map((msg, i) => (
        <MessageBubble key={`${msg.timestamp}-${i}`} message={msg} />
      ))}

      {isLoading && (
        <div className="flex justify-start" role="status" aria-live="polite">
          <div className="flex max-w-[85%] items-center gap-2 rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-2 text-sm text-gray-500">
            <Loader2
              className="h-3.5 w-3.5 animate-spin shrink-0"
              aria-hidden="true"
            />
            <span>{loadingStep}</span>
          </div>
        </div>
      )}

      <div ref={chatEndRef} />
    </div>
  );
}
