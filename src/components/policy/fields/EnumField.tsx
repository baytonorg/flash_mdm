import clsx from 'clsx';

interface EnumOption {
  value: string;
  label: string;
  description?: string;
}

interface EnumFieldProps {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  options: EnumOption[];
}

export default function EnumField({ label, description, value, onChange, options }: EnumFieldProps) {
  const useRadio = options.length <= 5;

  if (!useRadio) {
    return (
      <div className="py-3">
        <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
        {description && (
          <p className="text-xs text-gray-500 mb-2 leading-relaxed">{description}</p>
        )}
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="py-3">
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      {description && (
        <p className="text-xs text-gray-500 mb-2 leading-relaxed">{description}</p>
      )}
      <div className="space-y-2 mt-2">
        {options.map((opt) => (
          <label
            key={opt.value}
            className={clsx(
              'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
              value === opt.value
                ? 'border-accent bg-accent/5'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
            )}
          >
            <input
              type="radio"
              name={label}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="mt-0.5 h-4 w-4 text-accent focus:ring-accent/30"
            />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-gray-900">{opt.label}</span>
              {opt.description && (
                <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{opt.description}</p>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
