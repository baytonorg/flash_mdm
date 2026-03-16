# `src/utils/flashiProgress.ts`

> Generates contextual loading step messages for the Flashi chat UI. Uses keyword matching to produce category-specific progress steps.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `generateProgressSteps` | `(userMessage: string) => string[]` | Returns an array of progress step strings based on message content |

## Key Logic

Matches keywords in the user's message to generate relevant progress steps:

| Category | Keywords | Example steps |
|----------|----------|---------------|
| Devices | device, phone, tablet | "Querying device data...", "Analysing device states..." |
| Policies | policy, config, setting | "Loading policy data...", "Reviewing configurations..." |
| Groups | group, team, department | "Loading group hierarchy...", "Analysing group structure..." |
| Apps | app, application, play store | "Checking application data...", "Reviewing app configs..." |
| Enrolment | enrol, token, provision | "Loading enrolment data...", "Checking active tokens..." |
| Licensing | licen, billing, subscription | "Checking licensing status...", "Loading billing data..." |
| General | (fallback) | "Thinking...", "Looking into that..." |

Steps are displayed sequentially in the chat UI during loading, updating every 3 seconds.
