import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowLeft,
  Save,
  Loader2,
  Zap,
  FlaskConical,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import clsx from 'clsx';
import { useContextStore } from '@/stores/context';
import { useEnvironmentGuard } from '@/hooks/useEnvironmentGuard';
import {
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
  useTestWorkflow,
} from '@/api/queries/workflows';
import type { ConditionRow } from '@/api/queries/workflows';
import TriggerSelector from '@/components/workflows/TriggerSelector';
import ConditionBuilder from '@/components/workflows/ConditionBuilder';
import ActionSelector from '@/components/workflows/ActionSelector';
import ExecutionHistory from '@/components/workflows/ExecutionHistory';
import PageLoadingState from '@/components/common/PageLoadingState';

// ─── Section Accordion ──────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  step: number;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Section({ title, step, description, open, onToggle, children }: SectionProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between w-full px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-accent/10 text-accent text-sm font-semibold">
            {step}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{description}</p>
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        )}
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-gray-100 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function WorkflowBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const groups = useContextStore((s) => s.groups);
  const environmentId = activeEnvironment?.id;

  const isNew = !id;

  // ── Form state ──
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [triggerType, setTriggerType] = useState('device.enrolled');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({});
  const [conditions, setConditions] = useState<ConditionRow[]>([]);
  const [actionType, setActionType] = useState('device.command');
  const [actionConfig, setActionConfig] = useState<Record<string, unknown>>({});
  const [scopeType, setScopeType] = useState('environment');
  const [scopeId, setScopeId] = useState('');
  const [hasInitialised, setHasInitialised] = useState(false);

  // ── Section open state ──
  const [openSections, setOpenSections] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: false,
    4: true,
  });

  const toggleSection = (n: number) => {
    setOpenSections((prev) => ({ ...prev, [n]: !prev[n] }));
  };

  // ── Queries / Mutations ──
  const { data: workflowData, isLoading: isFetching, isError: isFetchError, error: fetchError } = useWorkflow(id ?? '');
  useEnvironmentGuard(workflowData?.workflow?.environment_id, '/workflows');
  const createMutation = useCreateWorkflow();
  const updateMutation = useUpdateWorkflow();
  const testMutation = useTestWorkflow();

  // Populate form from fetched workflow
  useEffect(() => {
    if (workflowData?.workflow && !hasInitialised) {
      const w = workflowData.workflow;
      setName(w.name);
      setEnabled(w.enabled);
      setTriggerType(w.trigger_type);
      setTriggerConfig(w.trigger_config ?? {});
      setConditions(w.conditions ?? []);
      setActionType(w.action_type);
      setActionConfig(w.action_config ?? {});
      setScopeType(w.scope_type ?? 'environment');
      setScopeId(w.scope_id ?? '');
      setHasInitialised(true);
    }
  }, [workflowData, hasInitialised]);

  // ── Handlers ──
  const handleSave = () => {
    if (!environmentId || !name.trim()) return;

    const payload = {
      environment_id: environmentId,
      name: name.trim(),
      enabled,
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      conditions,
      action_type: actionType,
      action_config: actionConfig,
      scope_type: scopeType,
      scope_id: scopeType === 'group' ? scopeId : undefined,
    };

    if (isNew) {
      createMutation.mutate(payload, {
        onSuccess: (data) => {
          navigate(`/workflows/${data.workflow.id}`, { replace: true });
        },
      });
    } else {
      updateMutation.mutate({ ...payload, id: id! });
    }
  };

  const handleTest = () => {
    if (!id) return;
    testMutation.mutate({ id });
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const saveError = createMutation.error || updateMutation.error;

  // ── Loading ──
  if (!isNew && isFetching) {
    return <PageLoadingState label="Loading workflow…" />;
  }

  // ── Fetch error ──
  if (!isNew && isFetchError) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/workflows')} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> Back to Workflows
        </button>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError instanceof Error ? fetchError.message : 'Failed to load workflow.'}
        </div>
      </div>
    );
  }

  // ── No environment ──
  if (!environmentId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Workflow Builder</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Zap className="mx-auto h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500">Select an environment to create or edit workflows.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Top bar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-4">
          <button
            onClick={() => navigate('/workflows')}
            className="inline-flex shrink-0 items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Workflows
          </button>
          <h1 className="min-w-0 text-2xl font-bold text-gray-900 break-words">
            {isNew ? 'Create Workflow' : 'Edit Workflow'}
          </h1>
        </div>

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          {!isNew && (
            <button
              onClick={handleTest}
              disabled={testMutation.isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors sm:w-auto"
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FlaskConical className="h-4 w-4" />
              )}
              Test Run
            </button>
          )}

          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent/90 disabled:opacity-50 transition-colors sm:w-auto"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isSaving ? 'Saving...' : 'Save Workflow'}
          </button>
        </div>
      </div>

      {/* Error display */}
      {saveError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {saveError instanceof Error ? saveError.message : 'Failed to save workflow.'}
        </div>
      )}

      {/* Success display */}
      {updateMutation.isSuccess && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
          Workflow saved successfully.
        </div>
      )}

      {/* Test success */}
      {testMutation.isSuccess && (
        <div className="mb-4 rounded-lg bg-purple-50 border border-purple-200 px-4 py-3 text-sm text-purple-700">
          Test execution created. Check execution history below for results.
        </div>
      )}
      {testMutation.isError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {testMutation.error instanceof Error ? testMutation.error.message : 'Test execution failed.'}
        </div>
      )}

      {/* Builder sections */}
      <div className="space-y-4 max-w-3xl">
        {/* Section 1: Basics */}
        <Section
          step={1}
          title="Basics"
          description="Name your workflow and set its scope."
          open={openSections[1]}
          onToggle={() => toggleSection(1)}
        >
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Workflow Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lock non-compliant devices"
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            {/* Enabled toggle */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setEnabled(!enabled)}
                className={clsx(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  enabled ? 'bg-accent' : 'bg-gray-300'
                )}
              >
                <span
                  className={clsx(
                    'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                    enabled ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </button>
              <span className="text-sm text-gray-700">
                {enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>

            {/* Scope */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Scope</label>
              <div className="mb-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { setScopeType('environment'); setScopeId(''); }}
                  className={clsx(
                    'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                    scopeType === 'environment'
                      ? 'border-accent bg-accent/5 text-accent'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  )}
                >
                  Entire Environment
                </button>
                <button
                  type="button"
                  onClick={() => setScopeType('group')}
                  className={clsx(
                    'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                    scopeType === 'group'
                      ? 'border-accent bg-accent/5 text-accent'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  )}
                >
                  Specific Group
                </button>
              </div>

              {scopeType === 'group' && (
                <select
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="">Select a group...</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {'  '.repeat(g.depth ?? 0)}{g.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </Section>

        {/* Section 2: Trigger */}
        <Section
          step={2}
          title="Trigger"
          description="Choose what event starts this workflow."
          open={openSections[2]}
          onToggle={() => toggleSection(2)}
        >
          <TriggerSelector
            value={{ trigger_type: triggerType, trigger_config: triggerConfig }}
            onChange={({ trigger_type, trigger_config }) => {
              setTriggerType(trigger_type);
              setTriggerConfig(trigger_config);
            }}
          />
        </Section>

        {/* Section 3: Conditions */}
        <Section
          step={3}
          title="Conditions"
          description="Optionally filter which devices this workflow applies to."
          open={openSections[3]}
          onToggle={() => toggleSection(3)}
        >
          <ConditionBuilder conditions={conditions} onChange={setConditions} />
        </Section>

        {/* Section 4: Action */}
        <Section
          step={4}
          title="Action"
          description="Choose what happens when the workflow triggers."
          open={openSections[4]}
          onToggle={() => toggleSection(4)}
        >
          <ActionSelector
            value={{ action_type: actionType, action_config: actionConfig }}
            onChange={({ action_type, action_config }) => {
              setActionType(action_type);
              setActionConfig(action_config);
            }}
          />
        </Section>

        {/* Execution History (only for existing workflows) */}
        {!isNew && workflowData?.recent_executions && (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Execution History</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Recent workflow executions (last 50).
              </p>
            </div>
            <div className="p-5">
              <ExecutionHistory executions={workflowData.recent_executions} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
