import { useQuery } from '@tanstack/react-query';
import { Monitor, FileText, KeyRound, ShieldCheck } from 'lucide-react';
import { useContextStore } from '@/stores/context';
import { apiClient } from '@/api/client';
import WidgetGrid from '@/components/dashboard/WidgetGrid';
import StatCard from '@/components/dashboard/StatCard';
import EnrollmentTrendsWidget from '@/components/dashboard/EnrollmentTrendsWidget';
import OemBreakdownWidget from '@/components/dashboard/OemBreakdownWidget';
import OsVersionWidget from '@/components/dashboard/OsVersionWidget';
import ComplianceWidget from '@/components/dashboard/ComplianceWidget';
import DeviceStateWidget from '@/components/dashboard/DeviceStateWidget';
import RecentEventsWidget from '@/components/dashboard/RecentEventsWidget';
import LivePageIndicator from '@/components/common/LivePageIndicator';

interface DashboardData {
  device_count: number;
  policy_count: number;
  enrollment_token_count: number;
  devices_by_state: Record<string, number>;
  devices_by_ownership: Record<string, number>;
  devices_by_management_mode: Record<string, number>;
  devices_by_manufacturer: Record<string, number>;
  devices_by_os_version: Record<string, number>;
  devices_by_security_patch: Record<string, number>;
  compliance_rate: number;
  enrollment_trend: Array<{ date: string; count: number }>;
  recent_events: Array<{ id: string; action: string; resource_type: string; created_at: string }>;
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-gray-200" />
        <div className="flex-1">
          <div className="h-4 w-24 bg-gray-200 rounded" />
          <div className="h-7 w-16 bg-gray-200 rounded mt-2" />
        </div>
      </div>
    </div>
  );
}

function SkeletonChart({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-6 animate-pulse ${className}`}>
      <div className="h-4 w-40 bg-gray-200 rounded mb-4" />
      <div className="h-48 bg-gray-100 rounded" />
    </div>
  );
}

export default function Dashboard() {
  const LIVE_REFRESH_MS = 30000;
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const environmentId = activeEnvironment?.id;

  const { data, isLoading, dataUpdatedAt } = useQuery<DashboardData>({
    queryKey: ['dashboard', environmentId],
    queryFn: () =>
      apiClient.get<DashboardData>(`/api/dashboard/data?environment_id=${environmentId}`),
    enabled: !!environmentId,
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: true,
  });

  // No environment selected
  if (!environmentId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Monitor className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-700 mb-1">No environment selected</h2>
          <p className="text-sm text-gray-500">
            Select a workspace and environment from the sidebar to view dashboard data.
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading || !data) {
    return (
      <div>
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <LivePageIndicator intervalMs={LIVE_REFRESH_MS} lastUpdatedAt={dataUpdatedAt} />
        </div>
        {/* Stat card skeletons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        {/* Chart skeletons */}
        <WidgetGrid>
          <SkeletonChart className="xl:col-span-2" />
          <SkeletonChart className="xl:col-span-2" />
          <SkeletonChart className="xl:col-span-2" />
          <SkeletonChart />
          <SkeletonChart />
          <SkeletonChart className="xl:col-span-2" />
        </WidgetGrid>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <LivePageIndicator intervalMs={LIVE_REFRESH_MS} lastUpdatedAt={dataUpdatedAt} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
        <StatCard
          label="Devices"
          value={data.device_count}
          icon={<Monitor className="w-5 h-5" />}
        />
        <StatCard
          label="Policies"
          value={data.policy_count}
          icon={<FileText className="w-5 h-5" />}
        />
        <StatCard
          label="Enrolment Tokens"
          value={data.enrollment_token_count}
          icon={<KeyRound className="w-5 h-5" />}
        />
        <StatCard
          label="Compliance"
          value={`${data.compliance_rate}%`}
          icon={<ShieldCheck className="w-5 h-5" />}
        />
      </div>

      {/* Chart widgets */}
      <WidgetGrid>
        <EnrollmentTrendsWidget data={data.enrollment_trend} />
        <OemBreakdownWidget data={data.devices_by_manufacturer} />
        <OsVersionWidget data={data.devices_by_os_version} />
        <ComplianceWidget rate={data.compliance_rate} />
        <DeviceStateWidget data={data.devices_by_state} />
        <RecentEventsWidget events={data.recent_events} />
      </WidgetGrid>
    </div>
  );
}
