import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface DeviceStateWidgetProps {
  data: Record<string, number>;
}

const STATE_COLORS: Record<string, string> = {
  ACTIVE: '#22c55e',
  DISABLED: '#9ca3af',
  DELETED: '#ef4444',
  PROVISIONING: '#3b82f6',
};

function formatLabel(state: string): string {
  return state
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export default function DeviceStateWidget({ data }: DeviceStateWidgetProps) {
  const entries = Object.entries(data);
  const labels = entries.map(([state]) => formatLabel(state));
  const values = entries.map(([, count]) => count);
  const colors = entries.map(([state]) => STATE_COLORS[state] ?? '#6366f1');

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Devices',
        data: values,
        backgroundColor: colors,
        borderRadius: 4,
        barThickness: 24,
      },
    ],
  };

  const options = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1f2937',
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: { color: '#f3f4f6' },
        ticks: { font: { size: 11 }, color: '#9ca3af', precision: 0 },
      },
      y: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: '#374151' },
      },
    },
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Devices by State</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500">No data available.</p>
      ) : (
        <div style={{ height: Math.max(120, entries.length * 40) }}>
          <Bar data={chartData} options={options} />
        </div>
      )}
    </div>
  );
}
