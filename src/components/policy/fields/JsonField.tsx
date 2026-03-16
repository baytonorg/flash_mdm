import { useEffect, useMemo, useRef, useState } from 'react';

type JsonKind = 'object' | 'array' | 'any';

interface JsonFieldProps {
  label: string;
  description?: string;
  value: any;
  onChange: (value: any) => void;
  kind?: JsonKind;
  placeholder?: string;
  rows?: number;
  validate?: (value: any) => string | null;
}

function isKind(value: any, kind: JsonKind): boolean {
  if (kind === 'any') return true;
  if (kind === 'array') return Array.isArray(value);
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pretty(value: any, kind: JsonKind): string {
  if (value === undefined) return kind === 'array' ? '[]' : kind === 'object' ? '{}' : '';
  if (value === null) return 'null';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

export default function JsonField({
  label,
  description,
  value,
  onChange,
  kind = 'any',
  placeholder,
  rows = 6,
  validate,
}: JsonFieldProps) {
  const serialized = useMemo(() => pretty(value, kind), [value, kind]);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState<string | null>(null);
  const lastPropValue = useRef(serialized);

  useEffect(() => {
    if (serialized !== lastPropValue.current) {
      setText(serialized);
      setError(null);
      lastPropValue.current = serialized;
    }
  }, [serialized]);

  return (
    <div className="py-3">
      <label className="block text-sm font-medium text-gray-900 mb-1">{label}</label>
      {description && <p className="text-xs text-gray-500 mb-2 leading-relaxed">{description}</p>}
      <textarea
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (!next.trim()) {
            const emptyValue = kind === 'array' ? [] : kind === 'object' ? {} : null;
            setError(null);
            onChange(emptyValue);
            return;
          }
          try {
            const parsed = JSON.parse(next);
            if (!isKind(parsed, kind)) {
              setError(kind === 'object' ? 'Value must be a JSON object.' : kind === 'array' ? 'Value must be a JSON array.' : 'Invalid JSON value.');
              return;
            }
            const validationError = validate?.(parsed) ?? null;
            setError(validationError);
            if (!validationError) onChange(parsed);
          } catch {
            setError('Invalid JSON.');
          }
        }}
        rows={rows}
        placeholder={placeholder}
        className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : (
        <p className="mt-1 text-xs text-gray-400">
          {kind === 'object' ? 'JSON object' : kind === 'array' ? 'JSON array' : 'JSON'} (parsed live)
        </p>
      )}
    </div>
  );
}
