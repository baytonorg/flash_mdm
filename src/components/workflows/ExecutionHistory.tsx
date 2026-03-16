import { CheckCircle, XCircle, Clock, SkipForward, FlaskConical, Smartphone } from 'lucide-react';
import clsx from 'clsx';
import type { WorkflowExecution } from '@/api/queries/workflows';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExecutionHistoryProps {
  executions: WorkflowExecution[];
}

// ─── Status Config ──────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, {
  icon: typeof CheckCircle;
  color: string;
  bg: string;
  label: string;
}> = {
  success: {
    icon: CheckCircle,
    color: 'text-green-600',
    bg: 'bg-green-50',
    label: 'Success',
  },
  failed: {
    icon: XCircle,
    color: 'text-red-600',
    bg: 'bg-red-50',
    label: 'Failed',
  },
  pending: {
    icon: Clock,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    label: 'Pending',
  },
  running: {
    icon: Clock,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    label: 'Running',
  },
  skipped: {
    icon: SkipForward,
    color: 'text-gray-500',
    bg: 'bg-gray-50',
    label: 'Skipped',
  },
  dry_run: {
    icon: FlaskConical,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    label: 'Dry Run',
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function ExecutionHistory({ executions }: ExecutionHistoryProps) {
  if (executions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
        <Clock className="mx-auto h-8 w-8 text-gray-300 mb-3" />
        <p className="text-sm text-gray-500">No executions yet.</p>
        <p className="text-xs text-gray-400 mt-1">
          Workflow executions will appear here once the workflow is triggered.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {executions.map((execution, index) => {
        const statusCfg = STATUS_CONFIG[execution.status] ?? STATUS_CONFIG.pending;
        const StatusIcon = statusCfg.icon;
        const isLast = index === executions.length - 1;

        return (
          <div key={execution.id} className="flex gap-3">
            {/* Timeline connector */}
            <div className="flex flex-col items-center">
              <div className={clsx('rounded-full p-1.5', statusCfg.bg)}>
                <StatusIcon className={clsx('h-4 w-4', statusCfg.color)} />
              </div>
              {!isLast && (
                <div className="w-px flex-1 bg-gray-200 my-1" />
              )}
            </div>

            {/* Execution content */}
            <div className={clsx('flex-1 pb-4', isLast ? '' : 'border-b-0')}>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                {/* Header row */}
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                      statusCfg.bg,
                      statusCfg.color
                    )}
                  >
                    <StatusIcon className="h-3 w-3" />
                    {statusCfg.label}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(execution.created_at).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>

                {/* Device info */}
                {(execution.manufacturer || execution.model || execution.serial_number) && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-2">
                    <Smartphone className="h-3 w-3 text-gray-400" />
                    <span>
                      {[execution.manufacturer, execution.model].filter(Boolean).join(' ')}
                      {execution.serial_number && (
                        <span className="text-gray-400 ml-1">({execution.serial_number})</span>
                      )}
                    </span>
                  </div>
                )}

                {/* Trigger data */}
                {execution.trigger_data && Object.keys(execution.trigger_data).length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-gray-500 mb-1">Trigger Data</p>
                    <pre className="rounded bg-gray-50 p-2 text-xs text-gray-600 overflow-x-auto max-h-20">
                      {JSON.stringify(execution.trigger_data, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Result */}
                {execution.result && Object.keys(execution.result).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1">Result</p>
                    <pre
                      className={clsx(
                        'rounded p-2 text-xs overflow-x-auto max-h-20',
                        execution.status === 'failed'
                          ? 'bg-red-50 text-red-700'
                          : 'bg-gray-50 text-gray-600'
                      )}
                    >
                      {JSON.stringify(execution.result, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
