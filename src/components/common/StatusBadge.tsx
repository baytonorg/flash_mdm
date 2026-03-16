import clsx from 'clsx';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'default';

export interface StatusBadgeProps {
  status: string;
  variant?: BadgeVariant;
}

const STATUS_VARIANT_MAP: Record<string, BadgeVariant> = {
  active: 'success',
  ACTIVE: 'success',
  enabled: 'success',
  ENABLED: 'success',
  production: 'success',
  PRODUCTION: 'success',
  compliant: 'success',
  COMPLIANT: 'success',
  online: 'success',
  ONLINE: 'success',

  disabled: 'warning',
  DISABLED: 'warning',
  draft: 'warning',
  DRAFT: 'warning',
  pending: 'warning',
  PENDING: 'warning',
  provisioning: 'warning',
  PROVISIONING: 'warning',
  lost: 'warning',
  LOST: 'warning',
  offline: 'warning',
  OFFLINE: 'warning',

  deleted: 'danger',
  DELETED: 'danger',
  archived: 'danger',
  ARCHIVED: 'danger',
  error: 'danger',
  ERROR: 'danger',
  failed: 'danger',
  FAILED: 'danger',
  non_compliant: 'danger',
  NON_COMPLIANT: 'danger',
  blocked: 'danger',
  BLOCKED: 'danger',
};

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-accent/10 text-accent',
  default: 'bg-gray-100 text-gray-600',
};

export default function StatusBadge({ status, variant }: StatusBadgeProps) {
  const resolvedVariant = variant ?? STATUS_VARIANT_MAP[status] ?? 'default';

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        variantClasses[resolvedVariant],
      )}
    >
      {status.toLowerCase().replace(/_/g, ' ')}
    </span>
  );
}
