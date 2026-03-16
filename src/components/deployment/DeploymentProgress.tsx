import { useState } from 'react';
import {
  Loader2,
  Rocket,
  CheckCircle2,
  XCircle,
  Ban,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react';
import clsx from 'clsx';
import {
  useDeploymentJob,
  useCreateDeployment,
  useCancelDeployment,
  useRollbackDeployment,
  type DeploymentJob,
} from '@/api/queries/deployments';

interface DeploymentProgressProps {
  /** If provided, shows the status of an existing job */
  jobId?: string | null;
  /** If provided, shows a "Deploy" button to create a new job */
  policyId?: string;
  environmentId?: string;
  /** Called when a new job is created */
  onJobCreated?: (jobId: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Rocket }> = {
  pending: { label: 'Pending', color: 'text-gray-500', icon: Loader2 },
  running: { label: 'Deploying', color: 'text-blue-600', icon: Loader2 },
  completed: { label: 'Completed', color: 'text-green-600', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'text-red-600', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'text-gray-500', icon: Ban },
  rolling_back: { label: 'Rolling back', color: 'text-amber-600', icon: RotateCcw },
  rolled_back: { label: 'Rolled back', color: 'text-amber-600', icon: RotateCcw },
  rollback_failed: { label: 'Rollback failed', color: 'text-red-600', icon: XCircle },
};

export default function DeploymentProgress({
  jobId,
  policyId,
  environmentId,
  onJobCreated,
}: DeploymentProgressProps) {
  const [activeJobId, setActiveJobId] = useState<string | null>(jobId ?? null);
  const [showErrors, setShowErrors] = useState(false);

  const { data: jobData } = useDeploymentJob(activeJobId);
  const createMutation = useCreateDeployment();
  const cancelMutation = useCancelDeployment();
  const rollbackMutation = useRollbackDeployment();

  const job = jobData?.job;

  const handleDeploy = async () => {
    if (!policyId || !environmentId) return;
    try {
      const result = await createMutation.mutateAsync({
        environment_id: environmentId,
        policy_id: policyId,
      });
      const newJobId = result.job.id;
      setActiveJobId(newJobId);
      onJobCreated?.(newJobId);
    } catch {
      // Error handled by mutation state
    }
  };

  const handleCancel = () => {
    if (!activeJobId) return;
    cancelMutation.mutate({ job_id: activeJobId });
  };

  const handleRollback = () => {
    if (!activeJobId) return;
    rollbackMutation.mutate({ job_id: activeJobId });
  };

  // No active job — show deploy button
  if (!job && !activeJobId) {
    if (!policyId || !environmentId) return null;

    return (
      <button
        onClick={handleDeploy}
        disabled={createMutation.isPending}
        className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-50 transition-colors"
      >
        {createMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Rocket className="h-4 w-4" />
        )}
        {createMutation.isPending ? 'Starting deployment...' : 'Deploy to Devices'}
      </button>
    );
  }

  // Loading job data
  if (!job) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading deployment status...
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;
  const isActive = job.status === 'pending' || job.status === 'running';
  const isDone = job.status === 'completed' || job.status === 'failed';
  const progressPercent = job.total_devices > 0
    ? Math.round(((job.completed_devices + job.failed_devices) / job.total_devices) * 100)
    : 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon
            className={clsx(
              'h-5 w-5',
              statusConfig.color,
              isActive && 'animate-spin',
            )}
          />
          <span className={clsx('text-sm font-semibold', statusConfig.color)}>
            {statusConfig.label}
          </span>
          {isActive && (
            <span className="text-xs text-gray-500">
              {job.completed_devices + job.failed_devices} / {job.total_devices} devices
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <button
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Ban className="h-3 w-3" />
              Cancel
            </button>
          )}
          {isDone && (
            <button
              onClick={handleRollback}
              disabled={rollbackMutation.isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              <RotateCcw className={clsx('h-3 w-3', rollbackMutation.isPending && 'animate-spin')} />
              Rollback
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {(isActive || isDone) && (
        <div className="px-4 pb-3">
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className={clsx(
                'h-full rounded-full transition-all duration-500',
                job.failed_devices > 0 && job.completed_devices === 0
                  ? 'bg-red-500'
                  : job.failed_devices > 0
                    ? 'bg-amber-500'
                    : 'bg-green-500',
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-gray-500">
            <div className="flex items-center gap-3">
              <span className="text-green-600">{job.completed_devices} completed</span>
              {job.failed_devices > 0 && (
                <span className="text-red-600">{job.failed_devices} failed</span>
              )}
              {job.skipped_devices > 0 && (
                <span className="text-gray-400">{job.skipped_devices} skipped</span>
              )}
            </div>
            <span>{progressPercent}%</span>
          </div>
        </div>
      )}

      {/* Error log */}
      {job.error_log.length > 0 && (
        <div className="border-t border-gray-100">
          <button
            onClick={() => setShowErrors(!showErrors)}
            className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {job.error_log.length} error{job.error_log.length !== 1 ? 's' : ''}
            </span>
            {showErrors ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showErrors && (
            <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
              {job.error_log.map((err, i) => (
                <div key={i} className="px-4 py-2 text-xs">
                  <span className="font-mono text-gray-400">{err.device_id.slice(0, 8)}...</span>
                  <span className="ml-2 text-red-600">{err.error}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timestamps */}
      {(job.started_at || job.completed_at) && (
        <div className="border-t border-gray-100 px-4 py-2 flex items-center gap-4 text-[10px] text-gray-400">
          {job.started_at && (
            <span>Started: {new Date(job.started_at).toLocaleTimeString()}</span>
          )}
          {job.completed_at && (
            <span>Completed: {new Date(job.completed_at).toLocaleTimeString()}</span>
          )}
          {job.cancelled_at && (
            <span>Cancelled: {new Date(job.cancelled_at).toLocaleTimeString()}</span>
          )}
        </div>
      )}
    </div>
  );
}
