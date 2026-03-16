# `src/components/enrollment/EnrollmentQrPreview.tsx`

> Renders a QR code image from a string value using the `qrcode` library, with loading and error states.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `EnrollmentQrPreview` | `default function` | QR code image renderer with loading spinner and error display |

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` | `string` | Yes | The string to encode as a QR code |
| `size` | `number` | No | Pixel width/height of the QR code image (default `240`) |

## Dependencies (imports from project)

None (only external: `qrcode`, `lucide-react`).

## Key Logic

Uses `useEffect` to call `QRCode.toDataURL` with error correction level "M" and margin 1 whenever `value` or `size` changes. An `active` flag guards against state updates after unmount. Three render states:

1. **Error** -- red border box with the error message.
2. **Loading** -- a bordered container matching the target size with a spinning `Loader2` icon.
3. **Ready** -- an `<img>` element displaying the generated data URL with alt text "Enrolment token QR code".
