# `src/components/apps/PlayStoreIframe.tsx`

> Embeds the managed Google Play iframe using the Google API (`gapi.iframes`), handling app selection and approval events via both the iframe API and `postMessage` fallback.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PlayStoreIframe` | `default function` | Renders the managed Google Play iframe |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `token` | `string` | Yes | Web token for authenticating with managed Google Play |
| `url` | `string` | Yes | Full iframe URL including the token |
| `onAppSelected` | `(packageName: string) => void` | No | Callback when an app is selected in the store |
| `onAppApproved` | `(packageName: string) => void` | No | Callback when an app is approved in the store |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `parseJsonIfPossible` | 38-48 | Safely attempts JSON.parse on a string value |
| `collectObjectCandidates` | 50-71 | Recursively collects nested objects from event payloads (checks data, payload, detail, message, params keys) |
| `parsePackageFromProductId` | 73-77 | Extracts package name from a `productId` string (e.g., `"app:com.example"`) |
| `extractProductSelectEvent` | 79-120 | Parses various Google Play event payload formats to extract action and packageName |
| `loadGapiScript` | 122-145 | Loads the Google API script (`apis.google.com/js/api.js`) with deduplication |
| `dispatchProductSelect` | 158-181 | Deduplicates and dispatches product select/approve events to callbacks |
| `handleMessage` | 183-191 | Window `message` event handler filtered to `play.google.com` origin |

## Key Logic

The component first attempts to load the Google API script and use `gapi.iframes` to open the managed Google Play iframe in a container div, registering for `onproductselect` events. If the gapi approach fails, it falls back to a plain `<iframe>` element. In both cases, it also listens for `window.postMessage` events from `play.google.com` as a secondary event channel. The `extractProductSelectEvent` function is defensive, searching through multiple possible event payload structures and key names to find the package name and action. Events are deduplicated within a 1-second window using a ref to prevent duplicate callbacks. The component cleans up by closing the iframe handle and removing the message listener on unmount.
