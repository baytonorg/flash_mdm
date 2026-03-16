import { Outlet } from 'react-router';
import { BRAND } from '@/lib/brand';

export default function GuestLayout() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8 md:p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{BRAND.name}</h1>
          <p className="text-gray-500 mt-2 text-sm md:text-base">{BRAND.tagline}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 md:p-8">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
