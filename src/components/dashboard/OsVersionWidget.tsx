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

interface OsVersionWidgetProps {
  data: Record<string, number>;
}

export default function OsVersionWidget({ data }: OsVersionWidgetProps) {
  // Sort versions descending (numerically if possible, otherwise lexicographically)
  const sorted = Object.entries(data).sort((a, b) => {
    const numA = Number(a[0]);
    const numB = Number(b[0]);
    if (!isNaN(numA) && !isNaN(numB)) return numB - numA;
    return b[0].localeCompare(a[0]);
  });

  const labels = sorted.map(([version]) => `Android ${version}`);
  const values = sorted.map(([, count]) => count);

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Devices',
        data: values,
        backgroundColor: '#3b82f6',
        borderRadius: 4,
        barThickness: 20,
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
    <div className="bg-white rounded-xl border border-gray-200 p-6 xl:col-span-2">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">OS Version Distribution</h3>
      {labels.length === 0 ? (
        <p className="text-sm text-gray-500">No data available.</p>
      ) : (
        <div style={{ height: Math.max(160, sorted.length * 36) }}>
          <Bar data={chartData} options={options} />
        </div>
      )}
    </div>
  );
}
