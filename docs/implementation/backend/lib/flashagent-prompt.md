# `netlify/functions/_lib/flashagent-prompt.ts`

> System prompt builder for Flashi. Constructs the system prompt with user context encoded as structured JSON to prevent semantic prompt injection.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `FlashiPromptContext` | `interface` | Context values for building the system prompt |
| `buildSystemPrompt` | `(ctx: FlashiPromptContext) => string` | Builds the complete system prompt |

## Internal Functions

| Name | Description |
|------|-------------|
| `sanitisePromptValue` | Strips newlines and markdown characters from user-controlled strings, limits length |

## Key Logic

The system prompt consists of four sections:

1. **Identity**: Flashi, the Flash MDM AI assistant.
2. **Capabilities**: AMAPI tools, Flash internal data, feature explanations.
3. **Rules**: Read-only only, factual, British English, stay on topic.
4. **User Context**: Encoded as a `JSON.stringify()` block inside a code fence. This prevents semantic prompt injection — the LLM reads workspace/environment/enterprise names as data fields, not as instructions.
5. **Safety**: Explicit reinforcement that user context is data only, with instructions to ignore embedded directives.

### Prompt injection defences

- `sanitisePromptValue()` strips `\r\n`, markdown chars (`#*_\`[]`), and limits to 100 chars (24 for role).
- User-controlled values are wrapped in `JSON.stringify()` inside a fenced code block.
- A trailing `## Safety` section explicitly tells the LLM to treat context as data.
