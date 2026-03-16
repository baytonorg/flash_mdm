export const DURATION_MONTH_OPTIONS = [1, 12, 24, 36] as const;

export function normalizeBillingDurationMonths(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return DURATION_MONTH_OPTIONS[0];
  return (DURATION_MONTH_OPTIONS as readonly number[]).includes(parsed)
    ? parsed
    : DURATION_MONTH_OPTIONS[0];
}
