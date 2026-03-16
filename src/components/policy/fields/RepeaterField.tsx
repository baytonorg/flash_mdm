import { type ReactNode } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';

interface RepeaterFieldProps {
  label: string;
  description?: string;
  value: any[];
  onChange: (value: any[]) => void;
  renderItem: (item: any, index: number, onChange: (item: any) => void) => ReactNode;
  defaultItem: any;
  maxItems?: number;
}

export default function RepeaterField({
  label,
  description,
  value,
  onChange,
  renderItem,
  defaultItem,
  maxItems,
}: RepeaterFieldProps) {
  const handleAdd = () => {
    if (maxItems !== undefined && value.length >= maxItems) return;
    onChange([...value, typeof defaultItem === 'object' ? { ...defaultItem } : defaultItem]);
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, item: any) => {
    const next = [...value];
    next[index] = item;
    onChange(next);
  };

  return (
    <div className="py-3">
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      {description && (
        <p className="text-xs text-gray-500 mb-2 leading-relaxed">{description}</p>
      )}

      {value.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-400">
          No items added yet
        </div>
      )}

      <div className="space-y-2">
        {value.map((item, index) => (
          <div
            key={index}
            className="group relative flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3"
          >
            <div className="mt-1 flex-shrink-0 cursor-grab text-gray-300 hover:text-gray-400">
              <GripVertical className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              {renderItem(item, index, (updated) => handleItemChange(index, updated))}
            </div>
            <button
              type="button"
              onClick={() => handleRemove(index)}
              className="mt-1 flex-shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
              title="Remove item"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleAdd}
        disabled={maxItems !== undefined && value.length >= maxItems}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-accent hover:text-accent transition-colors"
      >
        <Plus className="h-4 w-4" />
        {maxItems !== undefined && value.length >= maxItems ? `Limit reached (${maxItems})` : 'Add item'}
      </button>
    </div>
  );
}
