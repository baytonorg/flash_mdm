import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
} from 'chart.js';
import { Doughnut } from 'react-chartjs-2';

ChartJS.register(ArcElement, Tooltip);

interface ComplianceWidgetProps {
  rate: number; // 0-100
}

function getColor(rate: number): string {
  if (rate >= 80) return '#22c55e';
  if (rate >= 50) return '#eab308';
  return '#ef4444';
}

export default function ComplianceWidget({ rate }: ComplianceWidgetProps) {
  const color = getColor(rate);
  const remaining = 100 - rate;

  const chartData = {
    datasets: [
      {
        data: [rate, remaining],
        backgroundColor: [color, '#f3f4f6'],
        borderWidth: 0,
        circumference: 360,
        rotation: -90,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '78%',
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Compliance Rate</h3>
      <div className="relative h-44 flex items-center justify-center">
        <Doughnut data={chartData} options={options} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold" style={{ color }}>
            {rate}%
          </span>
          <span className="text-xs text-gray-500 mt-1">Compliant</span>
        </div>
      </div>
    </div>
  );
}
