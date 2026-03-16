# `src/pages/PolicyEditor.tsx`

> Three-panel policy editor supporting form-based and JSON editing with AMAPI push, versioning, and policy derivatives.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PolicyEditor` | `React.FC` (default) | Policy create/edit page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `setDeep` | 75-86 | Immutably sets a deeply nested value by dot-separated path |
| `PolicyEditor` | 175-682 | Main page component with three-panel layout (category nav, editor, documentation) |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | API calls for create/update policies |
| `useContextStore` | `@/stores/context` | Active environment access |
| `useEnvironmentGuard` | `@/hooks/useEnvironmentGuard` | Redirect if policy belongs to a different environment |
| `PolicyCategoryNav` | `@/components/policy/PolicyCategoryNav` | Left navigation panel for policy categories |
| `PolicyFormSection` | `@/components/policy/PolicyFormSection` | Category-specific form fields |
| `PolicyJsonEditor` | `@/components/policy/PolicyJsonEditor` | Raw JSON editor view |
| `PolicyDerivativesPanel` | `@/components/policy/PolicyDerivativesPanel` | Scope-specific policy derivatives view |
| `PageLoadingState` | `@/components/common/PageLoadingState` | Loading spinner component |

## Key Logic

The page operates in two modes: create (no `id` param) and edit (with `id` param). In create mode, it first shows a setup form for policy name, description, and deployment scenario (fully managed, work profile, or dedicated). After clicking "Continue to Editor", the full editor loads.

The editor uses a three-panel layout:
- **Left panel**: `PolicyCategoryNav` lists policy categories (password, screen lock, device settings, network, applications, security, system updates, permissions, status reporting, personal usage, kiosk mode, compliance rules, cross-profile, location, advanced, and derivatives). Category availability varies by deployment scenario.
- **Center panel**: Either `PolicyFormSection` (form mode), `PolicyJsonEditor` (JSON mode), or `PolicyDerivativesPanel` (when the derivatives category is selected for existing policies).
- **Right panel**: Contextual documentation for the selected category, policy metadata (scenario, version, status, ID), and an editable description field.

The top bar includes a form/JSON view toggle, a "Push to AMAPI" checkbox, and a save button. Saving either creates or updates the policy via `apiClient`. When AMAPI push is enabled and the save results in a sync error, a warning banner displays the AMAPI status and error message.

The "Default" policy is read-only -- all editing controls are disabled and a notice is shown. Version conflicts from component recompilation trigger a confirmation dialog before overwriting local changes.

The `CATEGORY_HELP` map provides documentation text and optional AMAPI reference links for each category.
