# `src/components/policy/PolicyJsonEditor.tsx`

> Monaco-based JSON editor for directly editing the raw policy configuration object.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PolicyJsonEditor` | `React.FC<PolicyJsonEditorProps>` (default) | Renders a Monaco editor with JSON validation status bar |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `Record<string, any>` | Yes | The policy config object to edit |
| `onChange` | `(value: Record<string, any>) => void` | Yes | Callback with the parsed object whenever valid JSON is entered |
| `readOnly` | `boolean` | No | When true, disables editing (default: `false`) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `handleEditorMount` | 18-20 | Stores the Monaco editor instance ref on mount |
| `handleChange` | 22-36 | Parses edited text as JSON; updates validity state and calls `onChange` on success |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|

No project-internal imports. Uses `@monaco-editor/react` for the editor and `lucide-react` for status icons.

## Key Logic

Serializes the incoming `value` prop to a pretty-printed JSON string for the Monaco editor. On every edit, attempts `JSON.parse` on the new text. If parsing succeeds, sets `isValid` to true and calls `onChange` with the parsed object. If parsing fails, sets `isValid` to false and displays the error message. A status bar above the editor shows a green checkmark for valid JSON or an amber warning for invalid JSON. The Monaco editor is configured with word wrap, bracket pair colorization, format-on-paste, and automatic layout.
