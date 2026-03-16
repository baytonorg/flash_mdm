import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { ManagedProperty } from '@/api/queries/apps';

interface ManagedConfigEditorProps {
  schema: ManagedProperty[];
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}

interface FieldProps {
  property: ManagedProperty;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  depth?: number;
}

function isHiddenProperty(property: ManagedProperty): boolean {
  return property.type === 'HIDDEN';
}

function getRenderableNestedProperties(
  nestedProperties: ManagedProperty[] | undefined
): ManagedProperty[] {
  return (nestedProperties ?? []).filter((nested) => isRenderableProperty(nested));
}

function isRenderableProperty(property: ManagedProperty): boolean {
  if (isHiddenProperty(property)) return false;
  if (property.type === 'BUNDLE' || property.type === 'BUNDLE_ARRAY') {
    return getRenderableNestedProperties(property.nestedProperties).length > 0;
  }
  return true;
}

// ─── Individual field renderers ─────────────────────────────────────────────

function StringField({ property, value, onChange }: FieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{property.title}</label>
      {property.description && (
        <p className="text-xs text-gray-500 mb-1">{property.description}</p>
      )}
      <input
        type="text"
        value={(value as string) ?? (property.defaultValue as string) ?? ''}
        onChange={(e) => onChange(property.key, e.target.value)}
        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );
}

function BoolField({ property, value, onChange }: FieldProps) {
  const checked = value !== undefined ? Boolean(value) : Boolean(property.defaultValue);
  return (
    <div className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(property.key, e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
      />
      <div>
        <label className="text-sm font-medium text-gray-900">{property.title}</label>
        {property.description && (
          <p className="text-xs text-gray-500">{property.description}</p>
        )}
      </div>
    </div>
  );
}

function IntegerField({ property, value, onChange }: FieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{property.title}</label>
      {property.description && (
        <p className="text-xs text-gray-500 mb-1">{property.description}</p>
      )}
      <input
        type="number"
        value={(value as number) ?? (property.defaultValue as number) ?? ''}
        onChange={(e) => onChange(property.key, parseInt(e.target.value, 10) || 0)}
        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );
}

function ChoiceField({ property, value, onChange }: FieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{property.title}</label>
      {property.description && (
        <p className="text-xs text-gray-500 mb-1">{property.description}</p>
      )}
      <select
        value={(value as string) ?? (property.defaultValue as string) ?? ''}
        onChange={(e) => onChange(property.key, e.target.value)}
        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      >
        <option value="">-- Select --</option>
        {property.entries?.map((entry) => (
          <option key={entry.value} value={entry.value}>
            {entry.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function MultiselectField({ property, value, onChange }: FieldProps) {
  const selected = Array.isArray(value) ? (value as string[]) : [];

  const toggleValue = (entryValue: string) => {
    const updated = selected.includes(entryValue)
      ? selected.filter((v) => v !== entryValue)
      : [...selected, entryValue];
    onChange(property.key, updated);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">{property.title}</label>
      {property.description && (
        <p className="text-xs text-gray-500 mb-1">{property.description}</p>
      )}
      <div className="space-y-1 border border-gray-200 rounded-lg p-2 max-h-40 overflow-y-auto">
        {property.entries?.map((entry) => (
          <label key={entry.value} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(entry.value)}
              onChange={() => toggleValue(entry.value)}
              className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent/20"
            />
            <span className="text-sm text-gray-700">{entry.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function BundleField({ property, value, onChange, depth = 0 }: FieldProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const bundleValue = (value as Record<string, unknown>) ?? {};
  const visibleNestedProperties = getRenderableNestedProperties(property.nestedProperties);

  const handleChildChange = (key: string, childValue: unknown) => {
    onChange(property.key, { ...bundleValue, [key]: childValue });
  };

  return (
    <div className={clsx('border border-gray-200 rounded-lg', depth > 0 && 'ml-4')}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400" />
        )}
        <span className="text-sm font-medium text-gray-900">{property.title}</span>
      </button>
      {expanded && visibleNestedProperties.length > 0 && (
        <div className="px-3 pb-3 space-y-3">
          {property.description && (
            <p className="text-xs text-gray-500">{property.description}</p>
          )}
          {visibleNestedProperties.map((nested) => (
            <ManagedPropertyField
              key={nested.key}
              property={nested}
              value={bundleValue[nested.key]}
              onChange={handleChildChange}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BundleArrayField({ property, value, onChange, depth = 0 }: FieldProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const visibleNestedProperties = getRenderableNestedProperties(property.nestedProperties);
  const items = Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : [];

  const setItems = (next: Array<Record<string, unknown>>) => onChange(property.key, next);

  const handleItemChange = (index: number, item: Record<string, unknown>) => {
    const next = [...items];
    next[index] = item;
    setItems(next);
  };

  const addItem = () => setItems([...items, {}]);
  const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));

  return (
    <div className={clsx('border border-gray-200 rounded-lg', depth > 0 && 'ml-4')}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400" />
        )}
        <span className="text-sm font-medium text-gray-900">{property.title}</span>
        <span className="text-xs text-gray-400">({items.length})</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {property.description && <p className="text-xs text-gray-500">{property.description}</p>}
          {items.map((item, index) => (
            <div key={`${property.key}-${index}`} className="rounded-lg border border-gray-100 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Item {index + 1}</p>
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
              {visibleNestedProperties.map((nested) => (
                <ManagedPropertyField
                  key={`${property.key}-${index}-${nested.key}`}
                  property={nested}
                  value={item[nested.key]}
                  onChange={(childKey, childValue) => handleItemChange(index, { ...item, [childKey]: childValue })}
                  depth={depth + 1}
                />
              ))}
            </div>
          ))}
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Add item
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Router for property types ──────────────────────────────────────────────

function ManagedPropertyField({ property, value, onChange, depth = 0 }: FieldProps) {
  if (!isRenderableProperty(property)) {
    return null;
  }

  switch (property.type) {
    case 'BOOL':
      return <BoolField property={property} value={value} onChange={onChange} depth={depth} />;
    case 'INTEGER':
      return <IntegerField property={property} value={value} onChange={onChange} depth={depth} />;
    case 'CHOICE':
      return <ChoiceField property={property} value={value} onChange={onChange} depth={depth} />;
    case 'MULTISELECT':
      return <MultiselectField property={property} value={value} onChange={onChange} depth={depth} />;
    case 'BUNDLE':
      return <BundleField property={property} value={value} onChange={onChange} depth={depth} />;
    case 'BUNDLE_ARRAY':
      return <BundleArrayField property={property} value={value} onChange={onChange} depth={depth} />;
    case 'STRING':
    default:
      return <StringField property={property} value={value} onChange={onChange} depth={depth} />;
  }
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ManagedConfigEditor({ schema, value, onChange }: ManagedConfigEditorProps) {
  const handleFieldChange = (key: string, fieldValue: unknown) => {
    onChange({ ...value, [key]: fieldValue });
  };

  if (!schema || schema.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center">
        <p className="text-sm text-gray-500">
          This application does not have managed configuration properties.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-gray-900">Managed Configuration</h4>
      {schema.filter((property) => isRenderableProperty(property)).map((property) => (
        <ManagedPropertyField
          key={property.key}
          property={property}
          value={value[property.key]}
          onChange={handleFieldChange}
        />
      ))}
    </div>
  );
}
