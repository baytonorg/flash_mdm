# `src/components/flashi/FlashiMessageList.tsx`

> Renders the Flashi chat message list with role-based styling, markdown rendering, and loading indicators.

## Key Details

- User messages: right-aligned, accent background, white text.
- Assistant messages: left-aligned, grey background. Error messages (prefixed with warning emoji) use amber styling.
- Markdown detection: if assistant text contains markdown syntax, renders via `renderMarkdown()` with `dangerouslySetInnerHTML`.
- Otherwise renders as plain text with `white-space: pre-wrap`.

## Security

- **HTML escaping**: All text is escaped via `escapeHtml()` before markdown transforms.
- **Code block placeholders**: Uses `crypto.randomUUID()` to generate unpredictable placeholders (prevents injection via crafted placeholder strings).
- **URL validation**: `isSafeUrl()` only allows `http://` and `https://` protocols in links.
- **DOMPurify**: Final output is sanitised with a strict tag/attribute allowlist as defence-in-depth.

## Accessibility

- `role="log"` with `aria-live="polite"` on the message container.
- `role="status"` on the loading indicator.
- `aria-hidden="true"` on decorative spinner icon.
