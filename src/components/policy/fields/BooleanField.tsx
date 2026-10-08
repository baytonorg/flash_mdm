import clsx from 'clsx';

interface BooleanFieldProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export default function BooleanField({ label, description, value, onChange, disabled = false }: BooleanFieldProps) {
  return (
    <label className={clsx('flex items-start gap-3 py-3 group', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={clsx(
          'relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-accent/30 focus:ring-offset-2',
          disabled ? 'bg-gray-100' : value ? 'bg-accent' : 'bg-gray-200',
        )}
      >
        <span
          className={clsx(
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
            value ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
      <div className="flex-1 min-w-0">
        <span className={clsx('text-sm font-medium', disabled ? 'text-gray-400' : 'text-gray-900 group-hover:text-gray-700')}>{label}</span>
        {description && (
          <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">{description}</p>
        )}
      </div>
    </label>
  );
}
