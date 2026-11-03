import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

interface LogCardProps {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}

/** Shared shell for the platform log sections. */
export default function LogCard({ title, description, children, className = '', onOpenChange }: LogCardProps) {
  return (
    <details className={`group/log-card rounded-lg border border-gray-200 ${className}`} onToggle={event => onOpenChange?.(event.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{title}</p>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
        <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open/log-card:rotate-90" />
      </summary>
      <div className="border-t border-gray-100 px-4 py-3">{children}</div>
    </details>
  );
}
