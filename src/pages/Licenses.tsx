import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  ExternalLink,
  Loader2,
  Package,
  Receipt,
  Settings2,
  ShieldCheck,
  Ticket,
  Users,
} from 'lucide-react';
import { useContextStore } from '@/stores/context';
import { useAuthStore } from '@/stores/auth';
import { apiClient } from '@/api/client';
import {
  useLicenseStatus,
  useCreateCheckout,
} from '@/api/queries/licenses';
import type { LicenseStatusResponse } from '@/api/queries/licenses';
import { parseMajorInputToMinorUnits } from '@/utils/currency';
import { formatDate } from '@/utils/format';
import { DURATION_MONTH_OPTIONS, normalizeBillingDurationMonths } from '@/constants/billing';
import type { WorkspaceLicenseSettingsResponse } from '@/types/licensing';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type WorkspaceRole = 'viewer' | 'member' | 'admin' | 'owner';
type LicensesTab = 'workspace' | 'environment';
type WorkspaceSectionTab = 'overview' | 'billing_setup';
const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  viewer: 25,
  member: 50,
  admin: 75,
  owner: 100,
};

interface PlansResponse {
  plans: Array<{
    id: string;
    name: string;
    max_devices: number;
    stripe_price_id: string | null;
    features: Record<string, unknown>;
    unit_amount_cents?: number;
    currency?: string;
    stripe_interval_months?: number;
  }>;
}

interface LicenseGrantsResponse {
  grants: Array<{
    id: string;
    source: string;
    seat_count: number;
    starts_at: string;
    ends_at: string | null;
    status: string;
    created_at: string;
  }>;
  invoices: Array<{
    id: string;
    invoice_type: string;
    status: string;
    subtotal_cents: number;
    currency: string;
    due_at: string | null;
    paid_at: string | null;
    source: string | null;
    created_at: string;
  }>;
}

interface WorkspaceBillingConfigResponse {
  workspace_id: string;
  mode: 'disabled' | 'stripe';
  stripe_publishable_key: string | null;
  default_currency: string;
  default_pricing_id: string | null;
  billing_contact_name: string | null;
  billing_business_name: string | null;
  billing_email: string | null;
  has_stripe_secret_key: boolean;
  has_stripe_webhook_secret: boolean;
}

interface WorkspacePricingResponse {
  workspace_id: string;
  pricing: Array<{
    id: string;
    name: string;
    seat_price_cents: number;
    duration_months: number;
    active: boolean;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>;
  default_pricing_id: string | null;
  default_currency: string;
}

interface WorkspaceEnvironmentBillingResponse {
  environment: {
    id: string;
    name: string;
    workspace_id: string;
  };
  customer: {
    id: string;
    name: string | null;
    email: string | null;
    stripe_customer_id: string | null;
    pricing_id: string | null;
    status: string;
    updated_at: string;
  } | null;
  default_pricing_id: string | null;
  workspace_billing_mode: 'disabled' | 'stripe';
  effective_pricing: {
    id: string;
    name: string;
    seat_price_cents: number;
    duration_months: number;
    active: boolean;
  } | null;
  history?: {
    entitlements: Array<{
      id: string;
      source: string;
      seat_count: number;
      starts_at: string;
      ends_at: string | null;
      status: string;
      external_ref: string | null;
      created_at: string;
    }>;
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function hasRoleAtLeast(role: string | null | undefined, minRole: WorkspaceRole): boolean {
  if (!role) return false;
  const level = ROLE_LEVEL[role as WorkspaceRole] ?? 0;
  return level >= ROLE_LEVEL[minRole];
}

function getErrorMessage(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Request failed. Please try again.';
}

function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

function UsageRing({ used, total, className = '' }: { used: number; total: number; className?: string }) {
  const isUnlimited = total === -1;
  const pct = isUnlimited ? 0 : total === 0 ? 0 : Math.min((used / total) * 100, 100);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const color = pct >= 90 ? 'text-red-500' : pct >= 70 ? 'text-amber-500' : 'text-emerald-500';

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <svg width="136" height="136" viewBox="0 0 136 136" className="-rotate-90">
        <circle cx="68" cy="68" r={radius} fill="none" stroke="currentColor" strokeWidth="10" className="text-gray-100" />
        {!isUnlimited && (
          <circle
            cx="68"
            cy="68"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={`${color} transition-all duration-700`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-gray-900">{used}</span>
        <span className="text-xs text-gray-500">/ {isUnlimited ? '\u221E' : total}</span>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, alert }: { label: string; value: string | number; sub?: string; alert?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${alert ? 'border-red-200 bg-red-50/50' : 'border-gray-200 bg-white'}`}>
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-semibold ${alert ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function PhaseBadge({ phase, blocked }: { phase: string; blocked: boolean }) {
  const styles: Record<string, string> = {
    resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warn: 'bg-blue-50 text-blue-700 border-blue-200',
    block: 'bg-amber-50 text-amber-700 border-amber-200',
    disable: 'bg-orange-50 text-orange-700 border-orange-200',
    wipe: 'bg-red-50 text-red-700 border-red-200',
  };
  const label = blocked ? 'Enrolment blocked' : phase.charAt(0).toUpperCase() + phase.slice(1);
  const style = blocked ? 'bg-red-50 text-red-700 border-red-200' : (styles[phase] ?? 'bg-gray-50 text-gray-700 border-gray-200');

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  const styles: Record<string, string> = {
    stripe: 'bg-violet-50 text-violet-700',
    invoice: 'bg-blue-50 text-blue-700',
    manual: 'bg-gray-100 text-gray-700',
    gift: 'bg-amber-50 text-amber-700',
    workspace_manual: 'bg-gray-100 text-gray-700',
    workspace_free: 'bg-emerald-50 text-emerald-700',
    workspace_customer_payment: 'bg-violet-50 text-violet-700',
    workspace_to_superadmin: 'bg-blue-50 text-blue-700',
  };
  const label = source
    .replace(/superadmin/gi, 'platform')
    .replace(/_/g, ' ')
    .trim();
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[source] ?? 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'paid' || status === 'active'
    ? 'bg-emerald-500'
    : status === 'pending' || status === 'draft'
      ? 'bg-amber-400'
      : 'bg-gray-300';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function Collapsible({ title, icon, children, defaultOpen = false }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-6 py-4 text-left hover:bg-gray-50/50 transition-colors"
      >
        {icon}
        <span className="flex-1 text-sm font-semibold text-gray-900">{title}</span>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="border-t border-gray-100 px-6 py-5">{children}</div>}
    </div>
  );
}

function WorkspaceTab({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

function EnvironmentTab({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function Licenses() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const activeWorkspace = useContextStore((s) => s.activeWorkspace);
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const workspaceId = activeWorkspace?.id ?? null;
  const workspaceRole = activeWorkspace?.user_role ?? null;
  const environmentRole = activeEnvironment?.user_role ?? null;
  const hasWorkspaceScopedAccess = Boolean(user?.is_superadmin || activeWorkspace?.access_scope === 'workspace');
  const showWorkspaceTab = Boolean(user?.is_superadmin || hasWorkspaceScopedAccess);
  const readOnlyImpersonation = Boolean(user?.impersonation?.active && user.impersonation.mode === 'read_only');
  const memberEnvironmentOnlyView = Boolean(
    !showWorkspaceTab || (!user?.is_superadmin && !hasRoleAtLeast(workspaceRole, 'admin'))
  );
  const canManageWorkspaceBilling = Boolean(
    !readOnlyImpersonation && hasWorkspaceScopedAccess && hasRoleAtLeast(workspaceRole, 'admin')
  );
  const canManageEnvironmentBilling = Boolean(
    !readOnlyImpersonation
    && (hasRoleAtLeast(workspaceRole, 'admin') || hasRoleAtLeast(environmentRole, 'admin'))
  );

  /* ---- Form state ---- */
  const [checkoutForm, setCheckoutForm] = useState({
    seatCount: 10,
    selectedPlanId: '',
  });

  const [invoiceForm, setInvoiceForm] = useState({
    seatCount: 10,
    durationMonths: 12,
    planId: '',
    dueDays: 30,
  });

  const [newPricingForm, setNewPricingForm] = useState({
    name: '',
    seatAmount: '5',
    durationMonths: 1,
    active: true,
    setAsDefault: false,
  });
  const [workspaceCustomerDefaultsForm, setWorkspaceCustomerDefaultsForm] = useState({
    billingContactName: '',
    billingBusinessName: '',
    billingEmail: '',
  });

  const [environmentPurchaseForm, setEnvironmentPurchaseForm] = useState({
    seatCount: 10,
  });
  const [environmentManualGrantForm, setEnvironmentManualGrantForm] = useState({
    seatCount: 10,
    durationMonths: 1,
    noExpiry: false,
    grantType: 'free' as 'free' | 'manual',
    note: '',
  });
  const [workspaceLicenseForm, setWorkspaceLicenseForm] = useState({
    licensingEnabled: true,
    inheritPlatformFreeTier: true,
    workspaceFreeEnabled: true,
    workspaceFreeSeatLimit: 10,
  });
  const [activeTab, setActiveTab] = useState<LicensesTab>('workspace');
  const [activeWorkspaceSectionTab, setActiveWorkspaceSectionTab] = useState<WorkspaceSectionTab>('overview');

  /* ---- Queries ---- */
  const { data: status, isLoading } = useLicenseStatus({
    workspaceId: memberEnvironmentOnlyView ? null : workspaceId,
    environmentId: memberEnvironmentOnlyView ? (activeEnvironment?.id ?? null) : null,
  });
  const createCheckout = useCreateCheckout();

  const { data: plansData } = useQuery<PlansResponse>({
    queryKey: ['license-plans', workspaceId],
    queryFn: () => apiClient.get<PlansResponse>(`/api/licenses/plans?workspace_id=${workspaceId}`),
    enabled: !!workspaceId && !memberEnvironmentOnlyView && !!status && (status.workspace_licensing_settings?.effective_licensing_enabled ?? status.licensing_enabled ?? true),
    staleTime: 300_000,
  });

  const { data: grantsData, isLoading: grantsLoading } = useQuery<LicenseGrantsResponse>({
    queryKey: ['license-grants', workspaceId],
    queryFn: () => apiClient.get<LicenseGrantsResponse>(`/api/licenses/grants?workspace_id=${workspaceId}`),
    enabled: !!workspaceId && !memberEnvironmentOnlyView && !!status && (status.workspace_licensing_settings?.effective_licensing_enabled ?? status.licensing_enabled ?? true),
  });

  const { data: workspaceBillingConfig } = useQuery<WorkspaceBillingConfigResponse>({
    queryKey: ['workspace-billing', 'config', workspaceId],
    queryFn: () => apiClient.get<WorkspaceBillingConfigResponse>(`/api/workspace-billing/config?workspace_id=${workspaceId}`),
    enabled: !!workspaceId && !!status && (status.workspace_licensing_settings?.effective_licensing_enabled ?? status.licensing_enabled ?? true) && canManageWorkspaceBilling,
  });

  const { data: workspacePricing } = useQuery<WorkspacePricingResponse>({
    queryKey: ['workspace-billing', 'pricing', workspaceId],
    queryFn: () => apiClient.get<WorkspacePricingResponse>(`/api/workspace-billing/pricing?workspace_id=${workspaceId}`),
    enabled: !!workspaceId && !!status && (status.workspace_licensing_settings?.effective_licensing_enabled ?? status.licensing_enabled ?? true) && canManageWorkspaceBilling,
  });

  const { data: environmentBilling } = useQuery<WorkspaceEnvironmentBillingResponse>({
    queryKey: ['workspace-billing', 'environment', activeEnvironment?.id],
    queryFn: () => apiClient.get<WorkspaceEnvironmentBillingResponse>(`/api/workspace-billing/environments/${activeEnvironment?.id}`),
    enabled: !!activeEnvironment?.id && !!status && (status.workspace_licensing_settings?.effective_licensing_enabled ?? status.licensing_enabled ?? true) && canManageEnvironmentBilling,
  });

  const { data: workspaceLicenseSettings } = useQuery<WorkspaceLicenseSettingsResponse>({
    queryKey: ['license-settings', workspaceId],
    queryFn: () => apiClient.get<WorkspaceLicenseSettingsResponse>(`/api/licenses/settings?workspace_id=${workspaceId}`),
    enabled: !!workspaceId && !memberEnvironmentOnlyView,
  });

  useEffect(() => {
    const settings = workspaceLicenseSettings?.settings;
    if (!settings) return;
    setWorkspaceLicenseForm({
      licensingEnabled: settings.workspace_licensing_enabled,
      inheritPlatformFreeTier: settings.inherit_platform_free_tier,
      workspaceFreeEnabled: settings.workspace_free_enabled,
      workspaceFreeSeatLimit: settings.workspace_free_seat_limit,
    });
  }, [workspaceLicenseSettings?.settings]);

  useEffect(() => {
    setWorkspaceCustomerDefaultsForm({
      billingContactName: workspaceBillingConfig?.billing_contact_name ?? '',
      billingBusinessName: workspaceBillingConfig?.billing_business_name ?? '',
      billingEmail: workspaceBillingConfig?.billing_email ?? '',
    });
  }, [
    workspaceBillingConfig?.billing_contact_name,
    workspaceBillingConfig?.billing_business_name,
    workspaceBillingConfig?.billing_email,
  ]);

  /* ---- Mutations ---- */
  const invoiceRequestMutation = useMutation({
    mutationFn: (payload: {
      workspace_id: string;
      plan_id: string;
      seat_count: number;
      duration_months: number;
      due_days: number;
    }) => apiClient.post<{ message: string; invoice_id: string }>('/api/licenses/grants/invoice-request', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['license-grants', workspaceId] });
    },
  });

  const workspaceConfigMutation = useMutation({
    mutationFn: (payload: {
      workspace_id: string;
      mode: 'disabled' | 'stripe';
      stripe_publishable_key?: string;
      stripe_secret_key?: string;
      stripe_webhook_secret?: string;
      default_currency?: string;
      default_pricing_id?: string | null;
      billing_contact_name?: string | null;
      billing_business_name?: string | null;
      billing_email?: string | null;
    }) => apiClient.put<{ message: string }>('/api/workspace-billing/config', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-billing', 'config', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-billing', 'pricing', workspaceId] });
    },
  });

  const workspacePricingMutation = useMutation({
    mutationFn: (payload: {
      workspace_id: string;
      id?: string;
      name?: string;
      seat_price_cents?: number;
      duration_months?: number;
      active?: boolean;
      delete?: boolean;
      set_default?: boolean;
    }) => apiClient.put<{ message: string }>('/api/workspace-billing/pricing', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-billing', 'pricing', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-billing', 'config', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['workspace-billing', 'environment', activeEnvironment?.id] });
    },
  });

  const environmentMappingMutation = useMutation({
    mutationFn: (payload: {
      customer_name?: string | null;
      customer_email?: string | null;
      pricing_id?: string | null;
      status?: 'active' | 'inactive';
    }) => apiClient.put<{ message: string }>(`/api/workspace-billing/environments/${activeEnvironment?.id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-billing', 'environment', activeEnvironment?.id] });
    },
  });

  const workspaceCheckoutMutation = useMutation({
    mutationFn: (payload: {
      environment_id: string;
      pricing_id?: string;
      seat_count?: number;
      customer_name?: string;
      customer_email?: string;
    }) => apiClient.post<{ checkout_url: string }>('/api/workspace-billing/checkout', payload),
    onSuccess: (data) => {
      window.location.href = data.checkout_url;
    },
  });

  const workspacePortalMutation = useMutation({
    mutationFn: (payload: { environment_id: string }) =>
      apiClient.post<{ portal_url: string }>('/api/workspace-billing/portal', payload),
    onSuccess: (data) => {
      window.location.href = data.portal_url;
    },
  });

  const environmentManualGrantMutation = useMutation({
    mutationFn: (payload: {
      environment_id: string;
      seat_count: number;
      duration_months?: number;
      no_expiry?: boolean;
      grant_type?: 'manual' | 'free';
      note?: string;
    }) => apiClient.post<{ message: string; entitlement_id: string; source: string }>('/api/workspace-billing/grants/manual', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-billing', 'environment', activeEnvironment?.id] });
      queryClient.invalidateQueries({ queryKey: ['licenses', 'status', workspaceId] });
    },
  });

  const workspaceLicenseSettingsMutation = useMutation({
    mutationFn: (payload: {
      workspace_id: string;
      licensing_enabled: boolean;
      inherit_platform_free_tier: boolean;
      free_enabled: boolean;
      free_seat_limit: number;
    }) => apiClient.put<{ workspace_id: string; settings: WorkspaceLicenseSettingsResponse['settings'] }>('/api/licenses/settings', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['license-settings', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['licenses', 'status', workspaceId] });
    },
  });

  /* ---- Derived values ---- */
  const mutationErrorMessage = getErrorMessage(
    createCheckout.error
    ?? invoiceRequestMutation.error
    ?? workspaceConfigMutation.error
    ?? workspacePricingMutation.error
    ?? environmentMappingMutation.error
    ?? workspaceCheckoutMutation.error
    ?? workspacePortalMutation.error
    ?? environmentManualGrantMutation.error
    ?? workspaceLicenseSettingsMutation.error
  );

  const stripeEnabled = status?.stripe_enabled ?? false;
  const platformPlans = useMemo(
    () => plansData?.plans ?? [],
    [plansData]
  );
  const checkoutPlans = useMemo(
    () => platformPlans.filter((p) => p.stripe_price_id),
    [platformPlans]
  );

  const selectedCheckoutPlanId = checkoutForm.selectedPlanId || checkoutPlans[0]?.id || '';
  const selectedCheckoutPlan = platformPlans.find((p) => p.id === selectedCheckoutPlanId) ?? null;
  const selectedInvoicePlanId = invoiceForm.planId || platformPlans[0]?.id || '';
  const selectedInvoicePlan = platformPlans.find((p) => p.id === selectedInvoicePlanId) ?? null;
  const selectedCheckoutCurrency = (selectedCheckoutPlan?.currency ?? 'usd').toUpperCase();
  const selectedCheckoutUnitAmount = selectedCheckoutPlan?.unit_amount_cents ?? 0;
  const selectedCheckoutDuration = Math.max(1, selectedCheckoutPlan?.stripe_interval_months ?? 1);
  const selectedCheckoutSubtotal = selectedCheckoutUnitAmount * Math.max(1, checkoutForm.seatCount);
  const selectedInvoiceUnitAmount = selectedInvoicePlan?.unit_amount_cents ?? 0;
  const selectedInvoiceCurrency = selectedInvoicePlan?.currency ?? 'usd';
  const selectedInvoiceIntervalMonths = Math.max(1, selectedInvoicePlan?.stripe_interval_months ?? 1);
  const selectedInvoiceDuration = Math.max(1, invoiceForm.durationMonths);
  const selectedInvoiceBillingIntervals = Math.max(1, Math.ceil(selectedInvoiceDuration / selectedInvoiceIntervalMonths));
  const selectedInvoiceSubtotal = selectedInvoiceUnitAmount * Math.max(1, invoiceForm.seatCount) * selectedInvoiceBillingIntervals;
  const platformEntitledSeats = status?.platform_entitled_seats ?? status?.device_limit ?? 0;
  const platformConsumedSeats = status?.platform_consumed_seats ?? status?.device_count ?? 0;
  const platformOverageCount = status?.platform_overage_count ?? Math.max(0, platformConsumedSeats - platformEntitledSeats);
  const platformAvailableSeats = Math.max(0, platformEntitledSeats - platformConsumedSeats);
  const licensingEnabled = status?.workspace_licensing_settings?.effective_licensing_enabled ?? status?.licensing_enabled ?? true;
  const platformLicensingEnabled = status?.workspace_licensing_settings?.platform_licensing_enabled ?? true;
  const hasEnvironmentTab = Boolean(activeEnvironment?.id);

  const freeTierSeats = status?.workspace_licensing_settings?.free_enabled
    ? status.workspace_licensing_settings.free_seat_limit
    : 0;
  const workspacePricingCount = workspacePricing?.pricing?.length ?? 0;
  const workspaceCustomerBillingEnabled = (environmentBilling?.workspace_billing_mode ?? 'disabled') === 'stripe';

  useEffect(() => {
    if (!hasEnvironmentTab && activeTab === 'environment') setActiveTab('workspace');
    if (!showWorkspaceTab && activeTab === 'workspace' && hasEnvironmentTab) setActiveTab('environment');
  }, [activeTab, hasEnvironmentTab, showWorkspaceTab]);

  useEffect(() => {
    if (!canManageWorkspaceBilling && activeWorkspaceSectionTab === 'billing_setup') {
      setActiveWorkspaceSectionTab('overview');
    }
  }, [activeWorkspaceSectionTab, canManageWorkspaceBilling]);

  /* ---- Billing history (unified timeline) ---- */
  const billingHistory = useMemo(() => {
    const items: Array<{
      id: string;
      type: 'grant' | 'invoice';
      date: string;
      label: string;
      detail: string;
      status: string;
      source: string;
    }> = [];

    for (const g of grantsData?.grants ?? []) {
      items.push({
        id: g.id,
        type: 'grant',
        date: g.created_at,
        label: `${g.seat_count} licence${g.seat_count !== 1 ? 's' : ''}`,
        detail: `${formatDate(g.starts_at)} \u2013 ${g.ends_at ? formatDate(g.ends_at) : 'No expiry'}`,
        status: g.status,
        source: g.source,
      });
    }
    for (const inv of grantsData?.invoices ?? []) {
      items.push({
        id: inv.id,
        type: 'invoice',
        date: inv.created_at,
        label: formatCurrency(inv.subtotal_cents, inv.currency),
        detail: inv.due_at ? `Due ${formatDate(inv.due_at)}` : 'No due date',
        status: inv.status,
        source: inv.invoice_type,
      });
    }

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  }, [grantsData]);

  /* ================================================================ */
  /*  RENDER – empty / loading / disabled states                       */
  /* ================================================================ */

  if (!workspaceId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Licences</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <CreditCard className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-700 mb-1">No workspace selected</h2>
          <p className="text-sm text-gray-500">Select a workspace to view licensing.</p>
        </div>
      </div>
    );
  }

  if (isLoading || !status) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Licences</h1>
        <div className="animate-pulse space-y-6">
          <div className="h-48 bg-gray-100 rounded-xl" />
          <div className="h-64 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!licensingEnabled) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Licences</h1>
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center max-w-lg mx-auto">
          <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Licensing is not active</h2>
          <p className="text-sm text-gray-500 mb-4">
            Licensing and enforcement are currently disabled for this workspace. Enrolment, billing, and device actions are unaffected.
          </p>
          {!platformLicensingEnabled && (
            <p className="text-sm text-amber-700 mb-4">
              Platform-wide licensing has been disabled by the platform administrator. Workspace controls are unavailable until it is re-enabled.
            </p>
          )}
          {canManageWorkspaceBilling && platformLicensingEnabled && (
            <button
              onClick={() => {
                workspaceLicenseSettingsMutation.mutate({
                  workspace_id: workspaceId,
                  licensing_enabled: true,
                  inherit_platform_free_tier: workspaceLicenseForm.inheritPlatformFreeTier,
                  free_enabled: workspaceLicenseForm.workspaceFreeEnabled,
                  free_seat_limit: workspaceLicenseForm.workspaceFreeSeatLimit,
                });
              }}
              disabled={workspaceLicenseSettingsMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {workspaceLicenseSettingsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Enable Licensing
            </button>
          )}
        </div>
      </div>
    );
  }

  if (memberEnvironmentOnlyView && !canManageEnvironmentBilling) {
    const envSnapshot = activeEnvironment?.id
      ? (status.environments ?? []).find((env) => env.environment_id === activeEnvironment.id)
      : null;
    const usedLicences = envSnapshot?.active_device_count ?? 0;
    const entitledLicences = envSnapshot?.entitled_seats ?? 0;
    const remainingLicences = Math.max(0, entitledLicences - usedLicences);
    const activeState = envSnapshot?.overage_count && envSnapshot.overage_count > 0 ? 'Over limit' : 'Compliant';

    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Licences</h1>
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            {activeEnvironment?.name ?? 'Environment'} licence usage
          </h3>
          {!envSnapshot ? (
            <p className="text-sm text-gray-500">No licensing snapshot available for this environment.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard label="Active" value={activeState} alert={activeState !== 'Compliant'} />
              <StatCard label="Used" value={usedLicences} />
              <StatCard label="Remaining" value={remainingLicences} />
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  RENDER – main licensed view                                      */
  /* ================================================================ */

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Licences</h1>
        {status.license?.current_period_end && (
          <p className="text-xs text-gray-400">
            Renews {formatDate(status.license.current_period_end)}
          </p>
        )}
      </div>

      {!canManageWorkspaceBilling && !canManageEnvironmentBilling && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          You have read-only access. Billing actions require workspace admin or owner permissions.
        </div>
      )}

      {mutationErrorMessage && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {mutationErrorMessage}
        </div>
      )}

      <div className="mb-6 inline-flex rounded-xl border border-gray-200 bg-white p-1 gap-1">
        {showWorkspaceTab && (
          <button
            type="button"
            onClick={() => setActiveTab('workspace')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === 'workspace'
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
            aria-pressed={activeTab === 'workspace'}
          >
            <Package className="w-3.5 h-3.5" />
            Workspace
          </button>
        )}
        {hasEnvironmentTab && (
          <button
            type="button"
            onClick={() => setActiveTab('environment')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === 'environment'
                ? 'bg-gray-900 text-white'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
            aria-pressed={activeTab === 'environment'}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Environment
          </button>
        )}
      </div>

      {activeTab === 'workspace' && showWorkspaceTab && (
        <WorkspaceTab>
          {canManageWorkspaceBilling && (
            <div className="inline-flex w-fit rounded-xl border border-gray-200 bg-white p-1 gap-1">
              <button
                type="button"
                onClick={() => setActiveWorkspaceSectionTab('overview')}
                className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium transition ${
                  activeWorkspaceSectionTab === 'overview'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
                aria-pressed={activeWorkspaceSectionTab === 'overview'}
              >
                Workspace overview
              </button>
              <button
                type="button"
                onClick={() => setActiveWorkspaceSectionTab('billing_setup')}
                className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium transition ${
                  activeWorkspaceSectionTab === 'billing_setup'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
                aria-pressed={activeWorkspaceSectionTab === 'billing_setup'}
              >
                Configure plans & pricing
              </button>
            </div>
          )}

          {activeWorkspaceSectionTab === 'overview' && (
            <>
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                  <div className="flex flex-col items-center gap-2">
                    <UsageRing used={platformConsumedSeats} total={platformEntitledSeats} />
                    <p className="text-xs text-gray-500">Licences used</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-4">
                      <h2 className="text-lg font-bold text-gray-900">{status.plan.name}</h2>
                      {status.license?.status && status.license.status !== 'active' && (
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                          {status.license.status}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <StatCard label="Total licences" value={platformEntitledSeats === -1 ? 'Unlimited' : platformEntitledSeats} />
                      <StatCard label="In use" value={platformConsumedSeats} />
                      <StatCard label="Available" value={platformEntitledSeats === -1 ? '\u221E' : platformAvailableSeats} />
                      <StatCard label="Over limit" value={platformOverageCount} alert={platformOverageCount > 0} sub={platformOverageCount > 0 ? 'Action required' : undefined} />
                    </div>
                    {freeTierSeats > 0 && (
                      <p className="mt-3 text-xs text-gray-500">
                        Includes {freeTierSeats} free licence{freeTierSeats !== 1 ? 's' : ''} ({status.workspace_licensing_settings?.inherit_platform_free_tier ? 'platform default' : 'workspace override'})
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Environment usage and compliance</h3>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left text-xs font-medium text-gray-500 px-6 py-3">Environment</th>
                      <th className="text-right text-xs font-medium text-gray-500 px-6 py-3">In use</th>
                      <th className="text-right text-xs font-medium text-gray-500 px-6 py-3">Entitled</th>
                      <th className="text-right text-xs font-medium text-gray-500 px-6 py-3">Overage</th>
                      <th className="text-left text-xs font-medium text-gray-500 px-6 py-3">Phase</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(status.environments ?? []).map((env) => (
                      <tr key={env.environment_id} className="hover:bg-gray-50/50">
                        <td className="px-6 py-3">
                          <p className="text-sm font-medium text-gray-900">{env.environment_name ?? env.environment_id}</p>
                        </td>
                        <td className="px-6 py-3 text-right text-sm text-gray-900">{env.active_device_count}</td>
                        <td className="px-6 py-3 text-right text-sm text-gray-700">{env.entitled_seats}</td>
                        <td className="px-6 py-3 text-right">
                          <span className={`text-sm font-medium ${env.overage_count > 0 ? 'text-red-700' : 'text-gray-400'}`}>
                            {env.overage_count > 0 ? `+${env.overage_count}` : '\u2014'}
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          <PhaseBadge phase={env.overage_phase} blocked={env.enrollment_blocked} />
                        </td>
                      </tr>
                    ))}
                    {(status.environments ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-400">No environments found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-900">Payment and history</h3>
                </div>
                {canManageWorkspaceBilling ? (
                  <div className="p-6 space-y-4 border-b border-gray-100">
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Workspace billing details</p>
                  <p className="text-xs text-gray-500 mb-3">
                    Used for workspace-level Stripe purchases from the platform (workspace checkout in this section).
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Customer name</label>
                      <input
                        type="text"
                        value={workspaceCustomerDefaultsForm.billingContactName}
                        onChange={(e) => setWorkspaceCustomerDefaultsForm((prev) => ({ ...prev, billingContactName: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        placeholder="Jane Doe"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Business name</label>
                      <input
                        type="text"
                        value={workspaceCustomerDefaultsForm.billingBusinessName}
                        onChange={(e) => setWorkspaceCustomerDefaultsForm((prev) => ({ ...prev, billingBusinessName: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        placeholder="Acme Ltd"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                      <input
                        type="email"
                        value={workspaceCustomerDefaultsForm.billingEmail}
                        onChange={(e) => setWorkspaceCustomerDefaultsForm((prev) => ({ ...prev, billingEmail: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        placeholder="billing@company.com"
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <button
                      onClick={() => {
                        workspaceConfigMutation.mutate({
                          workspace_id: workspaceId,
                          mode: workspaceBillingConfig?.mode ?? 'disabled',
                          stripe_publishable_key: workspaceBillingConfig?.stripe_publishable_key ?? '',
                          default_currency: workspaceBillingConfig?.default_currency ?? 'usd',
                          default_pricing_id: workspaceBillingConfig?.default_pricing_id ?? null,
                          billing_contact_name: workspaceCustomerDefaultsForm.billingContactName || null,
                          billing_business_name: workspaceCustomerDefaultsForm.billingBusinessName || null,
                          billing_email: workspaceCustomerDefaultsForm.billingEmail || null,
                        });
                      }}
                      disabled={workspaceConfigMutation.isPending}
                      className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {workspaceConfigMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save customer defaults
                    </button>
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Purchase licenses through Stripe</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Subscription tier</label>
                      <select
                        value={selectedCheckoutPlanId}
                        onChange={(e) => setCheckoutForm((prev) => ({ ...prev, selectedPlanId: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        {platformPlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>{plan.name}</option>
                        ))}
                        {platformPlans.length === 0 && <option value="">No plans available</option>}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Quantity</label>
                      <input type="number" min={1} value={checkoutForm.seatCount} onChange={(e) => setCheckoutForm((prev) => ({ ...prev, seatCount: Number(e.target.value) || 1 }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Duration</label>
                      <input
                        readOnly
                        value={`${selectedCheckoutDuration} month${selectedCheckoutDuration !== 1 ? 's' : ''} (fixed by plan)`}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
                      />
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                    Estimated total: <span className="font-semibold text-gray-900">{formatCurrency(selectedCheckoutSubtotal, selectedCheckoutPlan?.currency ?? 'usd')}</span>{' '}
                    <span className="text-xs text-gray-500">({selectedCheckoutCurrency} {formatCurrency(selectedCheckoutUnitAmount, selectedCheckoutPlan?.currency ?? 'usd')} per seat per {selectedCheckoutDuration} month{selectedCheckoutDuration !== 1 ? 's' : ''})</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        if (!selectedCheckoutPlanId || !stripeEnabled) return;
                        createCheckout.mutate({
                          workspace_id: workspaceId,
                          plan_id: selectedCheckoutPlanId,
                          seat_count: checkoutForm.seatCount,
                          duration_months: selectedCheckoutDuration,
                        });
                      }}
                      disabled={!stripeEnabled || !selectedCheckoutPlanId || createCheckout.isPending}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {createCheckout.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                      Pay with Stripe
                    </button>
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Purchase licenses via invoice request</p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Invoice plan</label>
                      <select value={selectedInvoicePlanId} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, planId: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        {platformPlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>{plan.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Invoice quantity</label>
                      <input type="number" min={1} value={invoiceForm.seatCount} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, seatCount: Number(e.target.value) || 1 }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Invoice duration</label>
                      <select value={invoiceForm.durationMonths} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, durationMonths: normalizeBillingDurationMonths(e.target.value) }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        {DURATION_MONTH_OPTIONS.map((months) => (
                          <option key={months} value={months}>{months} month{months !== 1 ? 's' : ''}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Payment terms</label>
                      <select
                        value={invoiceForm.dueDays}
                        onChange={(e) => setInvoiceForm((prev) => ({ ...prev, dueDays: Number(e.target.value) }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value={15}>Net 15</option>
                        <option value={30}>Net 30</option>
                        <option value={45}>Net 45</option>
                        <option value={60}>Net 60</option>
                        <option value={90}>Net 90</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                    Invoice total: <span className="font-semibold text-gray-900">{formatCurrency(selectedInvoiceSubtotal, selectedInvoiceCurrency)}</span>{' '}
                    <span className="text-xs text-gray-500">({formatCurrency(selectedInvoiceUnitAmount, selectedInvoiceCurrency)} per seat per {selectedInvoiceIntervalMonths} month{selectedInvoiceIntervalMonths !== 1 ? 's' : ''} x {selectedInvoiceBillingIntervals} billing interval{selectedInvoiceBillingIntervals !== 1 ? 's' : ''})</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        if (!selectedInvoicePlanId) return;
                        invoiceRequestMutation.mutate({
                          workspace_id: workspaceId,
                          plan_id: selectedInvoicePlanId,
                          seat_count: invoiceForm.seatCount,
                          duration_months: invoiceForm.durationMonths,
                          due_days: invoiceForm.dueDays,
                        });
                      }}
                      disabled={invoiceRequestMutation.isPending || !selectedInvoicePlanId}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {invoiceRequestMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ticket className="w-4 h-4" />}
                      Request invoice
                    </button>
                  </div>
                </div>
              </div>
            ) : (
                  <div className="px-6 py-4 text-sm text-gray-500 border-b border-gray-100">
                    Read-only licensing view. Billing actions require workspace admin or owner access.
                  </div>
                )}
                <div className="divide-y divide-gray-50">
                  {grantsLoading ? (
                    <div className="px-6 py-8 text-center text-sm text-gray-400">Loading...</div>
                  ) : billingHistory.length === 0 ? (
                    <div className="px-6 py-8 text-center text-sm text-gray-400">No billing activity yet.</div>
                  ) : (
                    billingHistory.slice(0, 20).map((item) => (
                      <div key={item.id} className="flex items-center gap-4 px-6 py-3">
                        <StatusDot status={item.status} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{item.label}</p>
                          <p className="text-xs text-gray-500">{item.detail}</p>
                        </div>
                        <SourceBadge source={item.source} />
                        <span className="text-xs text-gray-400 whitespace-nowrap">{formatDate(item.date)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {canManageWorkspaceBilling && activeWorkspaceSectionTab === 'billing_setup' && (
            <>
              <Collapsible title="Workspace customer licensing settings" icon={<Settings2 className="w-4 h-4 text-gray-500" />} defaultOpen>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-sm cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={workspaceLicenseForm.licensingEnabled} disabled={!platformLicensingEnabled} onChange={(e) => setWorkspaceLicenseForm((prev) => ({ ...prev, licensingEnabled: e.target.checked }))} className="rounded" />
                      <div>
                        <p className="font-medium text-gray-900">Workspace licensing enabled</p>
                        <p className="text-xs text-gray-500">Disable to bypass licensing in this workspace.</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-sm cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={workspaceLicenseForm.inheritPlatformFreeTier} onChange={(e) => setWorkspaceLicenseForm((prev) => ({ ...prev, inheritPlatformFreeTier: e.target.checked }))} className="rounded" />
                      <div>
                        <p className="font-medium text-gray-900">Inherit platform free tier</p>
                        <p className="text-xs text-gray-500">Use platform defaults for free licences.</p>
                      </div>
                    </label>
                  </div>
                  {!workspaceLicenseForm.inheritPlatformFreeTier && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-sm cursor-pointer hover:bg-gray-50">
                        <input type="checkbox" checked={workspaceLicenseForm.workspaceFreeEnabled} onChange={(e) => setWorkspaceLicenseForm((prev) => ({ ...prev, workspaceFreeEnabled: e.target.checked }))} className="rounded" />
                        <div>
                          <p className="font-medium text-gray-900">Free tier enabled</p>
                          <p className="text-xs text-gray-500">Grant workspace free licences.</p>
                        </div>
                      </label>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Free licence limit</label>
                        <input type="number" min={0} max={1000000} value={workspaceLicenseForm.workspaceFreeSeatLimit} onChange={(e) => setWorkspaceLicenseForm((prev) => ({ ...prev, workspaceFreeSeatLimit: Math.max(0, Math.min(1_000_000, Number(e.target.value) || 0)) }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      workspaceLicenseSettingsMutation.mutate({
                        workspace_id: workspaceId,
                        licensing_enabled: workspaceLicenseForm.licensingEnabled,
                        inherit_platform_free_tier: workspaceLicenseForm.inheritPlatformFreeTier,
                        free_enabled: workspaceLicenseForm.workspaceFreeEnabled,
                        free_seat_limit: workspaceLicenseForm.workspaceFreeSeatLimit,
                      });
                    }}
                    disabled={workspaceLicenseSettingsMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {workspaceLicenseSettingsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Save workspace settings
                  </button>
                </div>
              </Collapsible>

              <Collapsible title="Workspace customer billing settings" icon={<Users className="w-4 h-4 text-gray-500" />} defaultOpen>
                <div className="space-y-4">
                  <form
                    key={`workspace-config-${workspaceId}`}
                    className="space-y-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      workspaceConfigMutation.mutate({
                        workspace_id: workspaceId,
                        mode: (form.get('mode') as 'disabled' | 'stripe') ?? 'disabled',
                        stripe_publishable_key: String(form.get('stripe_publishable_key') ?? ''),
                        stripe_secret_key: String(form.get('stripe_secret_key') ?? ''),
                        stripe_webhook_secret: String(form.get('stripe_webhook_secret') ?? ''),
                        default_currency: String(form.get('default_currency') ?? 'usd'),
                        default_pricing_id: String(form.get('default_pricing_id') ?? '') || null,
                        billing_contact_name: workspaceCustomerDefaultsForm.billingContactName || null,
                        billing_business_name: workspaceCustomerDefaultsForm.billingBusinessName || null,
                        billing_email: workspaceCustomerDefaultsForm.billingEmail || null,
                      });
                    }}
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                        <select name="mode" defaultValue={workspaceBillingConfig?.mode ?? 'disabled'} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                          <option value="disabled">Disabled</option>
                          <option value="stripe">Stripe</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Default currency</label>
                        <select name="default_currency" defaultValue={workspaceBillingConfig?.default_currency ?? 'usd'} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                          <option value="usd">USD</option>
                          <option value="gbp">GBP</option>
                          <option value="eur">EUR</option>
                          <option value="cad">CAD</option>
                          <option value="aud">AUD</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Publishable key</label>
                        <input name="stripe_publishable_key" defaultValue={workspaceBillingConfig?.stripe_publishable_key ?? ''} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono text-xs" placeholder="pk_live_..." />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Default pricing ID (optional)</label>
                        <input name="default_pricing_id" defaultValue={workspaceBillingConfig?.default_pricing_id ?? ''} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Secret key {workspaceBillingConfig?.has_stripe_secret_key && <span className="ml-1 text-emerald-600 font-normal">(saved)</span>}</label>
                        <input name="stripe_secret_key" type="password" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Leave blank to keep current" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Webhook secret {workspaceBillingConfig?.has_stripe_webhook_secret && <span className="ml-1 text-emerald-600 font-normal">(saved)</span>}</label>
                        <input name="stripe_webhook_secret" type="password" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Leave blank to keep current" />
                      </div>
                    </div>
                    <button type="submit" disabled={workspaceConfigMutation.isPending} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                      {workspaceConfigMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save billing config
                    </button>
                  </form>
                </div>
              </Collapsible>

              <Collapsible title="Workspace customer pricing plans" icon={<Receipt className="w-4 h-4 text-gray-500" />} defaultOpen>
                <div className="space-y-4">
                  <p className="text-xs font-medium text-gray-600">Existing workspace pricing plans</p>
                  <div className="space-y-2">
                    {(workspacePricing?.pricing ?? []).map((price) => (
                      <div key={price.id} className="flex items-center gap-4 rounded-lg border border-gray-200 px-4 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{price.name}</p>
                          <p className="text-xs text-gray-500">{formatCurrency(price.seat_price_cents, workspacePricing?.default_currency ?? 'usd')} per licence / {price.duration_months} month{price.duration_months !== 1 ? 's' : ''}</p>
                        </div>
                        <button onClick={() => workspacePricingMutation.mutate({ workspace_id: workspaceId, id: price.id, delete: true })} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">Remove</button>
                      </div>
                    ))}
                    {workspacePricingCount === 0 && <p className="text-sm text-gray-400">No pricing plans configured yet.</p>}
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Add pricing plan</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                      <input value={newPricingForm.name} onChange={(e) => setNewPricingForm((prev) => ({ ...prev, name: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Plan name" />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        value={newPricingForm.seatAmount}
                        onChange={(e) => setNewPricingForm((prev) => ({ ...prev, seatAmount: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        placeholder="Unit price"
                      />
                      <select value={newPricingForm.durationMonths} onChange={(e) => setNewPricingForm((prev) => ({ ...prev, durationMonths: normalizeBillingDurationMonths(e.target.value) }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        {DURATION_MONTH_OPTIONS.map((months) => (
                          <option key={months} value={months}>{months} month{months !== 1 ? 's' : ''}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newPricingForm.active} onChange={(e) => setNewPricingForm((prev) => ({ ...prev, active: e.target.checked }))} className="rounded" /> Active</label>
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newPricingForm.setAsDefault} onChange={(e) => setNewPricingForm((prev) => ({ ...prev, setAsDefault: e.target.checked }))} className="rounded" /> Set as default</label>
                    </div>
                    <button
                      onClick={() => {
                        workspacePricingMutation.mutate({
                          workspace_id: workspaceId,
                          name: newPricingForm.name,
                          seat_price_cents: parseMajorInputToMinorUnits(newPricingForm.seatAmount),
                          duration_months: newPricingForm.durationMonths,
                          active: newPricingForm.active,
                          set_default: newPricingForm.setAsDefault,
                        });
                        setNewPricingForm((prev) => ({ ...prev, name: '' }));
                      }}
                      disabled={workspacePricingMutation.isPending || !newPricingForm.name.trim()}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {workspacePricingMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Add pricing plan
                    </button>
                  </div>
                </div>
              </Collapsible>
            </>
          )}
        </WorkspaceTab>
      )}

      {activeTab === 'environment' && hasEnvironmentTab && activeEnvironment?.id && (
        <EnvironmentTab>
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">{activeEnvironment.name}</h3>
            {(() => {
              const envSnapshot = (status.environments ?? []).find((env) => env.environment_id === activeEnvironment.id);
              if (!envSnapshot) {
                return <p className="text-sm text-gray-500">No licensing snapshot available for this environment.</p>;
              }
              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="In use" value={envSnapshot.active_device_count} />
                  <StatCard label="Entitled" value={envSnapshot.entitled_seats} />
                  <StatCard label="Overage" value={envSnapshot.overage_count} alert={envSnapshot.overage_count > 0} />
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <p className="text-xs font-medium text-gray-500 mb-1">Compliance</p>
                    <PhaseBadge phase={envSnapshot.overage_phase} blocked={envSnapshot.enrollment_blocked} />
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="flex items-center gap-2 mb-1">
              <ArrowUpRight className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900">Environment licences</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Configure this environment's billing contact and optional plan override, then purchase licences for this environment only.
            </p>
            {canManageEnvironmentBilling ? (
              <div className="space-y-4">
                {!workspaceCustomerBillingEnabled && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Workspace customer billing is disabled. Environment billing details remain visible, but checkout and billing portal actions are unavailable.
                  </div>
                )}
                {canManageWorkspaceBilling && (
                  <form
                    key={`env-mapping-${workspaceId}-${activeEnvironment.id}`}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      environmentMappingMutation.mutate({
                        customer_name: String(form.get('customer_name') ?? '') || null,
                        customer_email: String(form.get('customer_email') ?? '') || null,
                        pricing_id: String(form.get('pricing_id') ?? '') || null,
                        status: (form.get('status') as 'active' | 'inactive') ?? 'active',
                      });
                    }}
                  >
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Customer name</label>
                      <input name="customer_name" defaultValue={environmentBilling?.customer?.name ?? ''} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      <p className="mt-1 text-[11px] text-gray-500">Internal/customer-facing billing contact label for this environment.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Customer email</label>
                      <input name="customer_email" defaultValue={environmentBilling?.customer?.email ?? ''} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      <p className="mt-1 text-[11px] text-gray-500">Used as Stripe customer email for checkout and billing portal.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Pricing plan override</label>
                      <select name="pricing_id" defaultValue={environmentBilling?.customer?.pricing_id ?? environmentBilling?.default_pricing_id ?? ''} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        <option value="">No override (workspace default)</option>
                        {(workspacePricing?.pricing ?? []).map((price) => (
                          <option key={price.id} value={price.id}>
                            {price.name} - {formatCurrency(price.seat_price_cents, workspacePricing?.default_currency ?? 'usd')} / {price.duration_months}m
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-gray-500">Use workspace default unless this environment needs different pricing.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                      <select name="status" defaultValue={environmentBilling?.customer?.status ?? 'active'} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                      <p className="mt-1 text-[11px] text-gray-500">Inactive prevents this mapping from being used for new billing actions.</p>
                    </div>
                    <div className="sm:col-span-2">
                      <button type="submit" disabled={environmentMappingMutation.isPending} className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
                        {environmentMappingMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Save environment mapping
                      </button>
                    </div>
                  </form>
                )}
                <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Licences to purchase</label>
                    <input type="number" min={1} value={environmentPurchaseForm.seatCount} onChange={(e) => setEnvironmentPurchaseForm((prev) => ({ ...prev, seatCount: Number(e.target.value) || 1 }))} className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  </div>
                  <button
                    onClick={() => {
                      workspaceCheckoutMutation.mutate({
                        environment_id: activeEnvironment.id,
                        seat_count: environmentPurchaseForm.seatCount,
                        pricing_id: environmentBilling?.customer?.pricing_id ?? environmentBilling?.default_pricing_id ?? undefined,
                        customer_name: environmentBilling?.customer?.name ?? undefined,
                        customer_email: environmentBilling?.customer?.email ?? undefined,
                      });
                    }}
                    disabled={workspaceCheckoutMutation.isPending || !workspaceCustomerBillingEnabled}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {workspaceCheckoutMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
                    Checkout for environment
                  </button>
                  <button
                    onClick={() => workspacePortalMutation.mutate({ environment_id: activeEnvironment.id })}
                    disabled={workspacePortalMutation.isPending || !workspaceCustomerBillingEnabled}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {workspacePortalMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                    Billing portal
                  </button>
                </div>
                {canManageWorkspaceBilling && (
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Grant licences manually (no Stripe)</p>
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Seats</label>
                        <input
                          type="number"
                          min={1}
                          max={1000000}
                          value={environmentManualGrantForm.seatCount}
                          onChange={(e) => setEnvironmentManualGrantForm((prev) => ({ ...prev, seatCount: Number(e.target.value) || 1 }))}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Duration</label>
                        <select
                          value={environmentManualGrantForm.durationMonths}
                          onChange={(e) => setEnvironmentManualGrantForm((prev) => ({ ...prev, durationMonths: Number(e.target.value) || 1 }))}
                          disabled={environmentManualGrantForm.noExpiry}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
                        >
                          {DURATION_MONTH_OPTIONS.map((months) => (
                            <option key={months} value={months}>{months} month{months !== 1 ? 's' : ''}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                        <select
                          value={environmentManualGrantForm.grantType}
                          onChange={(e) => setEnvironmentManualGrantForm((prev) => ({ ...prev, grantType: e.target.value as 'free' | 'manual' }))}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        >
                          <option value="free">Free allocation</option>
                          <option value="manual">Manual adjustment</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-sm pt-6">
                        <input
                          type="checkbox"
                          checked={environmentManualGrantForm.noExpiry}
                          onChange={(e) => setEnvironmentManualGrantForm((prev) => ({ ...prev, noExpiry: e.target.checked }))}
                          className="rounded"
                        />
                        No expiry
                      </label>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Note (optional)</label>
                        <input
                          value={environmentManualGrantForm.note}
                          onChange={(e) => setEnvironmentManualGrantForm((prev) => ({ ...prev, note: e.target.value }))}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          placeholder="Reason/reference"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        environmentManualGrantMutation.mutate({
                          environment_id: activeEnvironment.id,
                          seat_count: Math.max(1, Math.min(1_000_000, Math.trunc(environmentManualGrantForm.seatCount))),
                          duration_months: environmentManualGrantForm.noExpiry ? undefined : environmentManualGrantForm.durationMonths,
                          no_expiry: environmentManualGrantForm.noExpiry,
                          grant_type: environmentManualGrantForm.grantType,
                          note: environmentManualGrantForm.note.trim() || undefined,
                        });
                      }}
                      disabled={environmentManualGrantMutation.isPending}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {environmentManualGrantMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Grant licences
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Read-only mode: environment billing actions require environment admin or owner access.</p>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900">Environment transaction history</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {(environmentBilling?.history?.entitlements?.length ?? 0) === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-gray-400">No environment transactions found.</div>
              ) : (
                (environmentBilling?.history?.entitlements ?? []).map((entry) => (
                  <div key={entry.id} className="flex items-center gap-4 px-6 py-3">
                    <StatusDot status={entry.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {entry.seat_count} licence{entry.seat_count !== 1 ? 's' : ''}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(entry.starts_at)} - {entry.ends_at ? formatDate(entry.ends_at) : 'No expiry'}
                      </p>
                    </div>
                    <SourceBadge source={entry.source} />
                    <span className="text-xs text-gray-400 whitespace-nowrap">{formatDate(entry.created_at)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </EnvironmentTab>
      )}
    </div>
  );
}
