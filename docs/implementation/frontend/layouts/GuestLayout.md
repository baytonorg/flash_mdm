# `src/layouts/GuestLayout.tsx`

> Minimal centered layout for unauthenticated pages (login, signup, etc.) with brand name and tagline.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `GuestLayout` | `default function` | Centered card layout wrapping a React Router `<Outlet />` |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `BRAND` | `@/lib/brand` | Brand name and tagline displayed above the card |

## Key Logic

Renders a full-height centered layout (`min-h-screen`, `flex items-center justify-center`) with a gray background. Contains a max-width-md container with:

1. A header section showing `BRAND.name` as a heading and `BRAND.tagline` as a subtitle.
2. A white card with rounded corners, shadow, and border that wraps the `<Outlet />` for nested route content.

Responsive padding adjusts for mobile (`px-4 py-8`) vs desktop (`p-4`). Text sizing also scales between breakpoints.
