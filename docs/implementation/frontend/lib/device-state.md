# `src/lib/device-state.ts`

> Utility for deriving the display state of a device from its AMAPI snapshot. Prefers the `appliedState` field from the snapshot over the top-level `state` field, enabling accurate representation of states like `LOST` that are only reflected in `appliedState`.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `DeviceStateLike` | `interface` | Minimal device shape: `{ state: string; snapshot?: Record<string, unknown> \| null }` |
| `getDeviceDisplayState` | `(device: DeviceStateLike) => string` | Returns `snapshot.appliedState` if present and non-empty, otherwise falls back to `device.state` |

## Key Logic

The AMAPI device resource has both a top-level `state` field (management state) and an `appliedState` field nested in the snapshot. Certain states like `LOST` (when a device is in lost mode) are only reflected in `appliedState`, not in the top-level `state`. This utility centralises the resolution logic so all UI components display the correct effective state.
