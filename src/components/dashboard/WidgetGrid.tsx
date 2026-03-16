import type { ReactNode } from 'react';

interface WidgetGridProps {
  children: ReactNode;
}

export default function WidgetGrid({ children }: WidgetGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
      {children}
    </div>
  );
}
