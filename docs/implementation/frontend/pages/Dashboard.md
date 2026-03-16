# `src/pages/Dashboard.tsx`

> Main dashboard showing fleet statistics, compliance rates, enrollment trends, and recent events.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `Dashboard` | `React.FC` (default) | Dashboard page component |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `SkeletonCard` | 30-42 | Renders an animated placeholder for stat cards during loading |
| `SkeletonChart` | 44-51 | Renders an animated placeholder for chart widgets during loading |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Accessing active environment |
| `apiClient` | `@/api/client` | Fetching dashboard data |
| `WidgetGrid` | `@/components/dashboard/WidgetGrid` | Grid layout for chart widgets |
| `StatCard` | `@/components/dashboard/StatCard` | Numeric stat display cards |
| `EnrollmentTrendsWidget` | `@/components/dashboard/EnrollmentTrendsWidget` | Enrollment trend line chart |
| `OemBreakdownWidget` | `@/components/dashboard/OemBreakdownWidget` | Manufacturer distribution chart |
| `OsVersionWidget` | `@/components/dashboard/OsVersionWidget` | OS version distribution chart |
| `ComplianceWidget` | `@/components/dashboard/ComplianceWidget` | Compliance rate visualization |
| `DeviceStateWidget` | `@/components/dashboard/DeviceStateWidget` | Device state breakdown chart |
| `RecentEventsWidget` | `@/components/dashboard/RecentEventsWidget` | Recent audit events list |
| `LivePageIndicator` | `@/components/common/LivePageIndicator` | Live-refresh status indicator |

## Key Logic

The page fetches a `DashboardData` payload from `/api/dashboard/data` for the active environment using React Query, with auto-refresh every 10 seconds. The response includes device/policy/token counts, compliance rate, devices grouped by state/ownership/management mode/manufacturer/OS version/security patch, enrollment trend time-series data, and recent events. Four stat cards show device count, policy count, enrollment token count, and compliance percentage. Below that, a widget grid renders six chart/list widgets. Loading and no-environment states are handled with skeleton placeholders and an informational empty state respectively.
