import clsx from 'clsx';
import {
  Lock,
  Smartphone,
  Settings,
  Wifi,
  AppWindow,
  Shield,
  RefreshCw,
  KeyRound,
  BarChart3,
  UserCircle,
  Monitor,
  Scale,
  ArrowLeftRight,
  MapPin,
  Wrench,
  GitBranch,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface CategoryDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Which scenarios support this category. undefined = all scenarios. */
  scenarios?: string[];
}

const CATEGORIES: CategoryDef[] = [
  { id: 'password', label: 'Password Requirements', icon: Lock },
  { id: 'screenLock', label: 'Screen Lock', icon: Smartphone },
  { id: 'applications', label: 'Applications', icon: AppWindow },
  { id: 'network', label: 'Network', icon: Wifi },
  { id: 'deviceSettings', label: 'Device Settings', icon: Settings },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'systemUpdates', label: 'System Updates', icon: RefreshCw },
  { id: 'permissions', label: 'Permissions', icon: KeyRound },
  { id: 'statusReporting', label: 'Status Reporting', icon: BarChart3 },
  { id: 'personalUsage', label: 'Personal Usage', icon: UserCircle, scenarios: ['wp'] },
  { id: 'kioskMode', label: 'Kiosk Mode', icon: Monitor, scenarios: ['fm'] },
  { id: 'complianceRules', label: 'Compliance Rules', icon: Scale },
  { id: 'crossProfile', label: 'Cross-Profile', icon: ArrowLeftRight },
  { id: 'location', label: 'Location', icon: MapPin },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
];

const EXTRA_ITEMS: CategoryDef[] = [
  { id: 'derivatives', label: 'Policy Derivatives', icon: GitBranch },
];

interface PolicyCategoryNavProps {
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
  scenario: string;
  /** Hide non-policy categories (e.g. derivatives) for new policies. */
  isNew?: boolean;
}

export default function PolicyCategoryNav({
  activeCategory,
  onCategoryChange,
  scenario,
  isNew,
}: PolicyCategoryNavProps) {
  const filteredCategories = CATEGORIES.filter(
    (cat) => !cat.scenarios || cat.scenarios.includes(scenario),
  );

  const renderItem = (cat: CategoryDef) => {
    const Icon = cat.icon;
    const isActive = activeCategory === cat.id;
    return (
      <li key={cat.id}>
        <button
          type="button"
          onClick={() => onCategoryChange(cat.id)}
          className={clsx(
            'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
            isActive
              ? 'bg-accent/10 text-accent font-medium'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
          )}
        >
          <Icon className={clsx('h-4 w-4 flex-shrink-0', isActive ? 'text-accent' : 'text-gray-400')} />
          <span className="truncate">{cat.label}</span>
        </button>
      </li>
    );
  };

  return (
    <nav className="h-full overflow-y-auto py-2">
      <div className="px-3 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Policy Categories
        </h3>
      </div>
      <ul className="space-y-0.5 px-2">
        {filteredCategories.map(renderItem)}
      </ul>

      {!isNew && (
        <>
          <hr className="mx-3 my-2 border-gray-200" />
          <ul className="space-y-0.5 px-2">
            {EXTRA_ITEMS.map(renderItem)}
          </ul>
        </>
      )}
    </nav>
  );
}
