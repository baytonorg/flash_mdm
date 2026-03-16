import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

interface EnrollmentTrendsWidgetProps {
  data: Array<{ date: string; count: number }>;
}

export default function EnrollmentTrendsWidget({ data }: EnrollmentTrendsWidgetProps) {
  const chartData = {
    labels: data.map((d) =>
      new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    ),
    datasets: [
      {
        label: 'Enrolments',
        data: data.map((d) => d.count),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 5,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1f2937',
        titleFont: { size: 12 },
        bodyFont: { size: 12 },
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: '#9ca3af', maxTicksLimit: 8 },
      },
      y: {
        beginAtZero: true,
        grid: { color: '#f3f4f6' },
        ticks: { font: { size: 11 }, color: '#9ca3af', precision: 0 },
      },
    },
  } as const;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 xl:col-span-2">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Enrolment Trends (30 days)</h3>
      <div className="h-56">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
