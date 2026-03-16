# `src/pages/PolicyComponents.tsx`

> CRUD interface for reusable policy configuration fragments (components) that can be assigned to multiple policies.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `PolicyComponents` | `React.FC` (default) | Policy components list page |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `ComponentModal` | 57-278 | Modal dialog for creating or editing a policy component with JSON editor and Wi-Fi ONC helper |
| `PolicyComponents` | 282-498 | Main page component with category filter, data table, and create/edit/delete flows |

## Dependencies (imports from project)

| Import | From | Used for |
|--------|------|----------|
| `useContextStore` | `@/stores/context` | Active environment access |
| `DataTable`, `ColumnDef` (type) | `@/components/common/DataTable` | Sortable data table component |
| `useComponents`, `useCreateComponent`, `useUpdateComponent`, `useDeleteComponent`, `PolicyComponent` (type) | `@/api/queries/components` | CRUD hooks and type for policy components |

## Key Logic

The page lists policy components for the active environment, filtered by category. There are 13 categories (password, security, network, applications, device settings, system updates, permissions, kiosk mode, compliance rules, cross-profile, personal usage, reporting, advanced) each with a distinct badge color.

Components are displayed in a `DataTable` with name, category badge, and creation date columns. Each row has inline edit and delete action buttons.

The `ComponentModal` renders a form with name, description, category selector, and a JSON textarea for the config fragment. When the category is set to "network", an Open Wi-Fi Helper panel appears that generates an ONC `openNetworkConfiguration` fragment from SSID, auto-connect, and hidden SSID inputs.

Deleting a component shows a warning that it will also be removed from all assigned policies. State resets on environment switch.
