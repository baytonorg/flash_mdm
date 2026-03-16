import { useState } from 'react';
import { Plus, Minus, ChevronUp, ChevronDown, Eye } from 'lucide-react';
import clsx from 'clsx';
import {
  useComponents,
  usePolicyComponents,
  useAssignComponent,
  useUnassignComponent,
  type PolicyComponent,
  type ComponentAssignment,
} from '@/api/queries/components';
import { useContextStore } from '@/stores/context';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ComponentPickerProps {
  policyId: string;
}

// ─── Category badge helper ──────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  password: { bg: 'bg-red-100', text: 'text-red-700' },
  security: { bg: 'bg-orange-100', text: 'text-orange-700' },
  network: { bg: 'bg-blue-100', text: 'text-blue-700' },
  applications: { bg: 'bg-green-100', text: 'text-green-700' },
  deviceSettings: { bg: 'bg-purple-100', text: 'text-purple-700' },
  systemUpdates: { bg: 'bg-teal-100', text: 'text-teal-700' },
  permissions: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  kioskMode: { bg: 'bg-pink-100', text: 'text-pink-700' },
  complianceRules: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  crossProfile: { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  personalUsage: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  statusReporting: { bg: 'bg-slate-100', text: 'text-slate-700' },
  advanced: { bg: 'bg-gray-100', text: 'text-gray-700' },
};

function CategoryBadge({ category }: { category: string }) {
  const style = CATEGORY_STYLES[category] ?? { bg: 'bg-gray-100', text: 'text-gray-700' };
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', style.bg, style.text)}>
      {category}
    </span>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ComponentPicker({ policyId }: ComponentPickerProps) {
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const environmentId = activeEnvironment?.id;

  const { data: allComponents = [] } = useComponents(environmentId);
  const { data: assignments = [] } = usePolicyComponents(policyId);
  const assignMutation = useAssignComponent();
  const unassignMutation = useUnassignComponent();

  const [previewId, setPreviewId] = useState<string | null>(null);

  // Components not yet assigned
  const assignedIds = new Set(assignments.map((a) => a.id));
  const available = allComponents.filter((c) => !assignedIds.has(c.id));

  const handleAssign = (component: PolicyComponent) => {
    assignMutation.mutate({ policy_id: policyId, component_id: component.id });
  };

  const handleUnassign = (assignment: ComponentAssignment) => {
    unassignMutation.mutate({ policy_id: policyId, component_id: assignment.id });
  };

  const previewComponent = previewId
    ? allComponents.find((c) => c.id === previewId) ?? assignments.find((a) => a.id === previewId)
    : null;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-900">Policy Components</h3>

      <div className="grid grid-cols-2 gap-4">
        {/* Available components */}
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Available ({available.length})
          </h4>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {available.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-400">
                No components available. Create components first.
              </div>
            ) : (
              available.map((component) => (
                <div
                  key={component.id}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{component.name}</span>
                      <CategoryBadge category={component.category} />
                    </div>
                    {component.description && (
                      <p className="text-xs text-gray-500 truncate">{component.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => setPreviewId(previewId === component.id ? null : component.id)}
                      className="rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500 transition-colors"
                      title="Preview config"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleAssign(component)}
                      disabled={assignMutation.isPending}
                      className="rounded p-1 text-gray-300 hover:bg-green-50 hover:text-green-600 transition-colors"
                      title="Assign to policy"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Assigned components (ordered by priority) */}
        <div>
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Assigned ({assignments.length})
          </h4>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {assignments.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-400">
                No components assigned yet.
              </div>
            ) : (
              assignments.map((assignment, index) => (
                <div
                  key={assignment.id}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400 w-5">#{assignment.priority}</span>
                      <span className="text-sm font-medium text-gray-900 truncate">{assignment.name}</span>
                      <CategoryBadge category={assignment.category} />
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 ml-2">
                    <button
                      onClick={() => setPreviewId(previewId === assignment.id ? null : assignment.id)}
                      className="rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500 transition-colors"
                      title="Preview config"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleUnassign(assignment)}
                      disabled={unassignMutation.isPending}
                      className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                      title="Remove from policy"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Config preview */}
      {previewComponent && (
        <div className="border border-gray-200 rounded-lg bg-gray-50 p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-gray-600">
              Config Preview: {previewComponent.name}
            </h4>
            <button
              onClick={() => setPreviewId(null)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Close
            </button>
          </div>
          <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
            {JSON.stringify(previewComponent.config_fragment, null, 2)}
          </pre>
        </div>
      )}

      {/* Priority info */}
      {assignments.length > 1 && (
        <p className="text-xs text-gray-400">
          Components are merged in priority order (lowest first). Higher priority values override
          conflicting settings from lower priority components.
        </p>
      )}
    </div>
  );
}
