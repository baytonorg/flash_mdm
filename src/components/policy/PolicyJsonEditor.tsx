import { useState, useCallback, useRef } from 'react';
import Editor, { loader, type OnMount } from '@monaco-editor/react';
import { AlertTriangle, Check } from 'lucide-react';

loader.config({ paths: { vs: '/monaco/vs' } });

interface PolicyJsonEditorProps {
  value: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
  readOnly?: boolean;
}

export default function PolicyJsonEditor({ value, onChange, readOnly = false }: PolicyJsonEditorProps) {
  const [isValid, setIsValid] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const editorRef = useRef<any>(null);

  const jsonString = JSON.stringify(value, null, 2);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const handleChange = useCallback(
    (newValue: string | undefined) => {
      if (!newValue) return;
      try {
        const parsed = JSON.parse(newValue);
        setIsValid(true);
        setErrorMessage(null);
        onChange(parsed);
      } catch (err) {
        setIsValid(false);
        setErrorMessage(err instanceof Error ? err.message : 'Invalid JSON');
      }
    },
    [onChange],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Status bar */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
        <span className="text-xs font-medium text-gray-500">JSON Editor</span>
        <div className="flex items-center gap-1.5">
          {isValid ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              <span className="text-xs text-green-600">Valid JSON</span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs text-amber-600" title={errorMessage ?? undefined}>
                Invalid JSON
              </span>
            </>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          defaultLanguage="json"
          value={jsonString}
          onChange={handleChange}
          onMount={handleEditorMount}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            automaticLayout: true,
            formatOnPaste: true,
            formatOnType: true,
            bracketPairColorization: { enabled: true },
            padding: { top: 12 },
          }}
          theme="vs-light"
        />
      </div>
    </div>
  );
}
