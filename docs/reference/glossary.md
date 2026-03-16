# Glossary

- **AMAPI**: Android Management API — Google's managed device API used to configure and control Android devices.
- **Component**: a reusable policy building block (e.g. a pre-configured app, restriction, or network config) that can be attached to a policy.
- **Deployment job**: a batch operation that pushes policy changes to a set of devices, with progress tracking, cancellation, and rollback support.
- **Derivative**: a generated AMAPI policy resource produced from a local policy template for a specific scope (environment, group, or device). Derivatives incorporate shared items, overrides, and variable substitution.
- **Environment**: a workspace subdivision, typically corresponding to one AMAPI enterprise binding. Most resources (devices, policies, apps, networks) are scoped to an environment.
- **Enrollment token**: a token used to enrol a device into an environment. Maps to an AMAPI enrollment token resource.
- **Geofence**: a geographic boundary used to trigger automated actions on devices that enter or leave the defined area.
- **Group**: a logical grouping of devices within an environment, used for policy assignment and override scoping.
- **Override**: a sparse JSON patch applied at group or device scope that diverges from the inherited policy template for specific config sections.
- **Policy**: a JSON template that maps to an AMAPI Policy resource. Not pushed to AMAPI directly — derivatives are generated from it.
- **RBAC**: Role-based access control.
- **Superadmin**: privileged operator/support role with cross-workspace access.
- **Workspace**: the top-level tenant container. Each workspace can have multiple environments, users, and billing settings.
- **Workflow**: an event-driven automation rule that triggers actions (e.g. send command, assign policy) when device or system events match defined conditions.
