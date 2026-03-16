interface TextFieldProps {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}

export default function TextField({ label, description, value, onChange, placeholder, multiline }: TextFieldProps) {
  const inputClasses =
    'block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';

  return (
    <div className="py-3">
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      {description && (
        <p className="text-xs text-gray-500 mb-2 leading-relaxed">{description}</p>
      )}
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={4}
          className={inputClasses + ' resize-y'}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={inputClasses}
        />
      )}
    </div>
  );
}
