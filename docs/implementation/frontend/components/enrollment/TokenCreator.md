# `src/components/enrollment/TokenCreator.tsx`

> Modal dialog for creating an Android enrolment token with group assignment, personal usage, expiry, Wi-Fi, and provisioning extras configuration.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `TokenCreator` | `default function` | Enrolment token creation modal with form and post-creation QR display |
| `TokenCreatorProps` | `interface` | Props: `open`, `onClose`, `onCreated` |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `open` | `boolean` | Yes | Controls modal visibility |
| `onClose` | `() => void` | Yes | Callback to close the modal |
| `onCreated` | `() => void` | Yes | Callback when a token is successfully created (e.g., to refresh list) |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `applyProvisioningExtrasToQrPayload` | 52-98 | Parses QR JSON payload and injects Android provisioning extras (locale, timezone, Wi-Fi, skip flags) |
| `handleClose` | 140-151 | Resets all form state and mutation, then calls `onClose` |
| `handleCopyToken` | 153-163 | Copies token value to clipboard with 2-second "copied" feedback |
| `handleEscapeClose` | 165-167 | Stable ref for Escape key handler via `useEffectEvent` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `apiClient` | `@/api/client` | POST to `/api/enrolment/create` |
| `useContextStore` | `@/stores/context` | Access `activeEnvironment` and `groups` |
| `EnrollmentQrPreview` | `./EnrollmentQrPreview` | QR code rendering after token creation |

## Key Logic

The modal has two states: **creation form** and **post-creation display**.

**Creation form** fields:
- Token name (optional text)
- Group selector (defaults to shallowest group; "No group" option available)
- One-time use toggle
- Personal usage dropdown (unspecified, allowed, disallowed, dedicated/userless)
- Expiry in days (1--365, default 30)
- Provisioning Extras panel: locale, timezone, Wi-Fi SSID/password/security/hidden, skip encryption, skip education screens, leave all system apps enabled

The mutation POSTs to `/api/enrolment/create` via `useMutation`. On success, the modal switches to the **post-creation display** showing: a success banner, the token value with copy button, and the QR code (rendered via `EnrollmentQrPreview`). The QR payload is enriched with provisioning extras via `applyProvisioningExtrasToQrPayload` before rendering. An expandable `<details>` element shows the raw QR payload. The modal supports Escape key and backdrop click to close.
