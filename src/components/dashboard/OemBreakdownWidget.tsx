import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Doughnut } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip, Legend);

interface OemBreakdownWidgetProps {
  data: Record<string, number>;
}

const COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#f97316', '#6366f1', '#14b8a6', '#e11d48',
];

export default function OemBreakdownWidget({ data }: OemBreakdownWidgetProps) {
  const labels = Object.keys(data);
  const values = Object.values(data);

  const chartData = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: labels.map((_, i) => COLORS[i % COLORS.length]),
        borderWidth: 0,
        hoverOffset: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '60%',
    plugins: {
      legend: {
        position: 'right' as const,
        labels: {
          boxWidth: 12,
          padding: 12,
          font: { size: 12 },
          color: '#374151',
        },
      },
      tooltip: {
        backgroundColor: '#1f2937',
        padding: 10,
        cornerRadius: 8,
      },
    },
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 xl:col-span-2">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Devices by Manufacturer</h3>
      {labels.length === 0 ? (
        <p className="text-sm text-gray-500">No data available.</p>
      ) : (
        <div className="h-56">
          <Doughnut data={chartData} options={options} />
        </div>
      )}
    </div>
  );
}
