interface NumberFieldProps {
  label: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

export default function NumberField({ label, description, value, onChange, min, max }: NumberFieldProps) {
  return (
    <div className="py-3">
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      {description && (
        <p className="text-xs text-gray-500 mb-2 leading-relaxed">{description}</p>
      )}
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const num = Number(e.target.value);
          if (!isNaN(num)) onChange(num);
        }}
        min={min}
        max={max}
        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      {(min !== undefined || max !== undefined) && (
        <p className="mt-1 text-xs text-gray-400">
          {min !== undefined && max !== undefined
            ? `Range: ${min} - ${max}`
            : min !== undefined
              ? `Minimum: ${min}`
              : `Maximum: ${max}`}
        </p>
      )}
    </div>
  );
}
