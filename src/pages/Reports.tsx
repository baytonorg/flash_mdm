import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  BarChart3, Download, FileText, Shield, Package, Smartphone,
  Loader2, Check, AlertCircle, Calendar,
} from 'lucide-react';
import { useContextStore } from '@/stores/context';
import { apiClient } from '@/api/client';

interface ExportResult {
  export_id: string;
  export_url: string;
  record_count: number;
  format: string;
  type: string;
}

type ExportType = 'devices' | 'policies' | 'audit' | 'apps';
type ExportFormat = 'csv' | 'json';

const exportTypes: Array<{
  type: ExportType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    type: 'devices',
    label: 'Devices',
    description: 'Export all device data including hardware, software, and compliance info',
    icon: Smartphone,
  },
  {
    type: 'policies',
    label: 'Policies',
    description: 'Export all policies with their configurations',
    icon: Shield,
  },
  {
    type: 'audit',
    label: 'Audit Log',
    description: 'Export audit log entries with optional date range',
    icon: FileText,
  },
  {
    type: 'apps',
    label: 'Applications',
    description: 'Export managed application catalogue',
    icon: Package,
  },
];

interface CompletedExport extends ExportResult {
  timestamp: string;
}

export default function Reports() {
  const activeEnvironment = useContextStore((s) => s.activeEnvironment);
  const environmentId = activeEnvironment?.id;

  const [format, setFormat] = useState<ExportFormat>('csv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [completedExports, setCompletedExports] = useState<CompletedExport[]>([]);

  // Clear completed exports on environment switch (links are environment-specific)
  useEffect(() => { setCompletedExports([]); }, [environmentId]);

  const exportMutation = useMutation({
    mutationFn: (params: {
      environment_id: string;
      type: ExportType;
      format: ExportFormat;
      date_from?: string;
      date_to?: string;
    }) => apiClient.post<ExportResult>('/api/reports/export', params),
    onSuccess: (data) => {
      setCompletedExports((prev) => [
        { ...data, timestamp: new Date().toISOString() },
        ...prev,
      ]);
    },
  });

  const handleExport = (type: ExportType) => {
    if (!environmentId) return;
    const params: {
      environment_id: string;
      type: ExportType;
      format: ExportFormat;
      date_from?: string;
      date_to?: string;
    } = {
      environment_id: environmentId,
      type,
      format,
    };
    if (type === 'audit' && dateFrom) params.date_from = dateFrom;
    if (type === 'audit' && dateTo) params.date_to = dateTo;
    exportMutation.mutate(params);
  };

  if (!environmentId) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Reports & Export</h1>
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-700 mb-1">No environment selected</h2>
          <p className="text-sm text-gray-500">
            Select a workspace and environment to export data.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Reports & Export</h1>

      {/* Format selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <label className="text-sm font-medium text-gray-700 mr-3">Export format:</label>
            <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                onClick={() => setFormat('csv')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  format === 'csv'
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                CSV
              </button>
              <button
                onClick={() => setFormat('json')}
                className={`px-4 py-2 text-sm font-medium border-l border-gray-300 transition-colors ${
                  format === 'json'
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                JSON
              </button>
            </div>
          </div>

          {/* Date range for audit */}
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <label className="text-sm text-gray-600">Audit date range:</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-gray-400">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Export type cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {exportTypes.map((exportType) => {
          const isExporting = exportMutation.isPending && exportMutation.variables?.type === exportType.type;
          return (
            <div
              key={exportType.type}
              className="bg-white rounded-xl border border-gray-200 p-6 flex items-start justify-between"
            >
              <div className="flex items-start gap-4">
                <div className="p-2 rounded-lg bg-gray-100">
                  <exportType.icon className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{exportType.label}</h3>
                  <p className="text-sm text-gray-500 mt-1">{exportType.description}</p>
                </div>
              </div>
              <button
                onClick={() => handleExport(exportType.type)}
                disabled={exportMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 shrink-0 ml-4"
              >
                {isExporting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Export
              </button>
            </div>
          );
        })}
      </div>

      {/* Export result feedback */}
      {exportMutation.isError && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-6">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>Export failed: {exportMutation.error instanceof Error ? exportMutation.error.message : 'Unknown error'}</span>
        </div>
      )}

      {/* Recent exports */}
      {completedExports.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Recent Exports</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {completedExports.map((exp) => (
              <div key={exp.export_id} className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                  <Check className="w-4 h-4 text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {exp.type.charAt(0).toUpperCase() + exp.type.slice(1)} ({exp.format.toUpperCase()})
                    </p>
                    <p className="text-xs text-gray-500">
                      {exp.record_count} records &middot; {new Date(exp.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <a
                  href={exp.export_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  <Download className="w-4 h-4" />
                  Download
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
