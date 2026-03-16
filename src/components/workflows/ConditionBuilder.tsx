import { Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { ConditionRow } from '@/api/queries/workflows';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ConditionBuilderProps {
  conditions: ConditionRow[];
  onChange: (conditions: ConditionRow[]) => void;
}

// ─── Field Definitions ──────────────────────────────────────────────────────

interface FieldDef {
  value: string;
  label: string;
  operators: { value: string; label: string }[];
  valueType: 'select' | 'text' | 'boolean' | 'json';
  valueOptions?: { value: string; label: string }[];
}

const FIELD_DEFINITIONS: FieldDef[] = [
  {
    value: 'device.state',
    label: 'Device State',
    operators: [
      { value: 'equals', label: 'Equals' },
      { value: 'not_equals', label: 'Not Equals' },
    ],
    valueType: 'select',
    valueOptions: [
      { value: 'ACTIVE', label: 'Active' },
      { value: 'DISABLED', label: 'Disabled' },
      { value: 'DELETED', label: 'Deleted' },
      { value: 'PROVISIONING', label: 'Provisioning' },
    ],
  },
  {
    value: 'device.ownership',
    label: 'Device Ownership',
    operators: [
      { value: 'equals', label: 'Equals' },
      { value: 'not_equals', label: 'Not Equals' },
    ],
    valueType: 'select',
    valueOptions: [
      { value: 'COMPANY_OWNED', label: 'Company Owned' },
      { value: 'PERSONALLY_OWNED', label: 'Personally Owned' },
    ],
  },
  {
    value: 'device.os_version',
    label: 'OS Version',
    operators: [
      { value: 'eq', label: 'Equal to' },
      { value: 'gt', label: 'Greater than' },
      { value: 'lt', label: 'Less than' },
      { value: 'gte', label: 'Greater or equal' },
      { value: 'lte', label: 'Less or equal' },
    ],
    valueType: 'text',
  },
  {
    value: 'device.manufacturer',
    label: 'Manufacturer',
    operators: [
      { value: 'equals', label: 'Equals' },
      { value: 'contains', label: 'Contains' },
      { value: 'not_equals', label: 'Not Equals' },
    ],
    valueType: 'text',
  },
  {
    value: 'device.group',
    label: 'Device Group',
    operators: [
      { value: 'in', label: 'Is in group' },
      { value: 'not_in', label: 'Not in group' },
    ],
    valueType: 'text',
  },
  {
    value: 'device.compliant',
    label: 'Compliance Status',
    operators: [
      { value: 'equals', label: 'Equals' },
      { value: 'not_equals', label: 'Not Equals' },
    ],
    valueType: 'boolean',
  },
  {
    value: 'custom.field',
    label: 'Custom Field (JSON Path)',
    operators: [
      { value: 'equals', label: 'Equals' },
      { value: 'not_equals', label: 'Not Equals' },
      { value: 'contains', label: 'Contains' },
      { value: 'exists', label: 'Exists' },
    ],
    valueType: 'json',
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function ConditionBuilder({ conditions, onChange }: ConditionBuilderProps) {
  const addCondition = () => {
    onChange([
      ...conditions,
      { field: 'device.state', operator: 'equals', value: 'ACTIVE' },
    ]);
  };

  const removeCondition = (index: number) => {
    onChange(conditions.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, updates: Partial<ConditionRow>) => {
    const updated = conditions.map((c, i) => {
      if (i !== index) return c;
      const merged = { ...c, ...updates };

      // Reset operator and value when field changes
      if (updates.field && updates.field !== c.field) {
        const fieldDef = FIELD_DEFINITIONS.find((f) => f.value === updates.field);
        merged.operator = fieldDef?.operators[0]?.value ?? 'equals';
        if (fieldDef?.valueType === 'select' && fieldDef.valueOptions?.length) {
          merged.value = fieldDef.valueOptions[0].value;
        } else if (fieldDef?.valueType === 'boolean') {
          merged.value = true;
        } else if (fieldDef?.valueType === 'json') {
          merged.value = { path: '', expected: '' };
        } else {
          merged.value = '';
        }
      }

      return merged;
    });
    onChange(updated);
  };

  const renderValueInput = (condition: ConditionRow, index: number) => {
    const fieldDef = FIELD_DEFINITIONS.find((f) => f.value === condition.field);
    if (!fieldDef) return null;

    switch (fieldDef.valueType) {
      case 'select':
        return (
          <select
            value={String(condition.value ?? '')}
            onChange={(e) => updateCondition(index, { value: e.target.value })}
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            {fieldDef.valueOptions?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        );

      case 'boolean':
        return (
          <select
            value={String(condition.value)}
            onChange={(e) => updateCondition(index, { value: e.target.value === 'true' })}
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          >
            <option value="true">True (Compliant)</option>
            <option value="false">False (Non-compliant)</option>
          </select>
        );

      case 'json': {
        const jsonVal = (condition.value ?? { path: '', expected: '' }) as {
          path: string;
          expected: unknown;
        };
        return (
          <div className="flex gap-2">
            <input
              type="text"
              value={jsonVal.path ?? ''}
              onChange={(e) =>
                updateCondition(index, { value: { ...jsonVal, path: e.target.value } })
              }
              placeholder="JSON path (e.g. hardwareInfo.model)"
              className="block w-1/2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            {condition.operator !== 'exists' && (
              <input
                type="text"
                value={String(jsonVal.expected ?? '')}
                onChange={(e) =>
                  updateCondition(index, { value: { ...jsonVal, expected: e.target.value } })
                }
                placeholder="Expected value"
                className="block w-1/2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            )}
          </div>
        );
      }

      default:
        return (
          <input
            type="text"
            value={String(condition.value ?? '')}
            onChange={(e) => updateCondition(index, { value: e.target.value })}
            placeholder="Enter value..."
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        );
    }
  };

  return (
    <div className="space-y-3">
      {conditions.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
          <p className="text-sm text-gray-500 mb-2">No conditions added.</p>
          <p className="text-xs text-gray-400">
            Without conditions, the workflow action will run for every matching trigger event.
          </p>
        </div>
      )}

      {conditions.map((condition, index) => {
        const fieldDef = FIELD_DEFINITIONS.find((f) => f.value === condition.field);
        return (
          <div key={index}>
            {/* AND connector */}
            {index > 0 && (
              <div className="flex items-center gap-2 py-2">
                <div className="flex-1 border-t border-gray-200" />
                <span className="rounded-full bg-gray-100 px-3 py-0.5 text-xs font-medium text-gray-500 uppercase">
                  AND
                </span>
                <div className="flex-1 border-t border-gray-200" />
              </div>
            )}

            {/* Condition row */}
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 grid grid-cols-3 gap-2">
                  {/* Field selector */}
                  <select
                    value={condition.field}
                    onChange={(e) => updateCondition(index, { field: e.target.value })}
                    className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  >
                    {FIELD_DEFINITIONS.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>

                  {/* Operator selector */}
                  <select
                    value={condition.operator}
                    onChange={(e) => updateCondition(index, { operator: e.target.value })}
                    className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  >
                    {fieldDef?.operators.map((op) => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>

                  {/* Value input */}
                  {renderValueInput(condition, index)}
                </div>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => removeCondition(index)}
                  className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors flex-shrink-0 mt-1"
                  title="Remove condition"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Add condition button */}
      <button
        type="button"
        onClick={addCondition}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:border-gray-400 hover:text-gray-700 transition-colors"
      >
        <Plus className="h-4 w-4" />
        Add Condition
      </button>
    </div>
  );
}
