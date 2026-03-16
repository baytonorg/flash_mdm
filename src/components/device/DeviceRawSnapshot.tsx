import { useState, useCallback } from 'react';
import { Copy, Check, ChevronRight, ChevronDown, FileJson } from 'lucide-react';

export interface DeviceRawSnapshotProps {
  snapshot: Record<string, any> | null;
}

function JsonNode({ keyName, value, depth = 0 }: { keyName?: string; value: any; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);

  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);
  const isEmpty = isObject && Object.keys(value).length === 0;

  if (!isObject || value === null) {
    let displayValue: string;
    let colorClass = 'text-gray-900';

    if (value === null) {
      displayValue = 'null';
      colorClass = 'text-muted';
    } else if (typeof value === 'string') {
      displayValue = `"${value}"`;
      colorClass = 'text-green-700';
    } else if (typeof value === 'number') {
      displayValue = String(value);
      colorClass = 'text-blue-700';
    } else if (typeof value === 'boolean') {
      displayValue = String(value);
      colorClass = 'text-amber-700';
    } else {
      displayValue = String(value);
    }

    return (
      <div className="flex items-start gap-1" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <span className="text-purple-700 shrink-0">"{keyName}": </span>
        )}
        <span className={colorClass}>{displayValue}</span>
      </div>
    );
  }

  const entries = Object.entries(value);
  const bracket = isArray ? ['[', ']'] : ['{', '}'];

  if (isEmpty) {
    return (
      <div className="flex items-start gap-1" style={{ paddingLeft: depth * 16 }}>
        {keyName !== undefined && (
          <span className="text-purple-700 shrink-0">"{keyName}": </span>
        )}
        <span className="text-muted">{bracket[0]}{bracket[1]}</span>
      </div>
    );
  }

  return (
    <div style={{ paddingLeft: depth * 16 }}>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-0.5 hover:bg-gray-100 rounded px-0.5 -ml-0.5 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted shrink-0" />
        )}
        {keyName !== undefined && (
          <span className="text-purple-700">"{keyName}": </span>
        )}
        <span className="text-muted">
          {bracket[0]}
          {!expanded && (
            <span className="text-xs text-muted ml-1">
              {entries.length} {isArray ? 'items' : 'keys'}...
            </span>
          )}
          {!expanded && bracket[1]}
        </span>
      </button>

      {expanded && (
        <>
          {entries.map(([k, v], i) => (
            <div key={k}>
              <JsonNode
                keyName={isArray ? undefined : k}
                value={v}
                depth={depth + 1}
              />
              {i < entries.length - 1 && (
                <span className="text-muted" style={{ paddingLeft: (depth + 1) * 16 }}>
                </span>
              )}
            </div>
          ))}
          <div style={{ paddingLeft: depth * 16 }}>
            <span className="text-muted">{bracket[1]}</span>
          </div>
        </>
      )}
    </div>
  );
}

export default function DeviceRawSnapshot({ snapshot }: DeviceRawSnapshotProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!snapshot) return;
    navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [snapshot]);

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-border bg-surface px-4 py-12 text-center">
        <FileJson className="mx-auto h-8 w-8 text-gray-300 mb-2" />
        <p className="text-sm text-muted">No snapshot data available for this device.</p>
        <p className="text-xs text-muted mt-1">
          The raw AMAPI device snapshot will appear here once available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">Full AMAPI device snapshot</p>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-600" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy JSON
            </>
          )}
        </button>
      </div>

      <div className="rounded-lg border border-border bg-surface-secondary p-4 overflow-auto max-h-[600px]">
        <pre className="font-mono text-xs leading-relaxed">
          <JsonNode value={snapshot} />
        </pre>
      </div>
    </div>
  );
}
