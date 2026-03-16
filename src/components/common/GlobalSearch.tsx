import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Search, Smartphone, Shield, FolderTree, Users, X, Loader2 } from 'lucide-react';
import { apiClient } from '@/api/client';
import { useContextStore } from '@/stores/context';

interface SearchResult {
  id: string;
  name: string;
  category: 'device' | 'policy' | 'group' | 'user';
  path: string;
}

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_CONFIG = {
  device: { icon: Smartphone, label: 'Device', color: 'bg-blue-100 text-blue-700' },
  policy: { icon: Shield, label: 'Policy', color: 'bg-purple-100 text-purple-700' },
  group: { icon: FolderTree, label: 'Group', color: 'bg-green-100 text-green-700' },
  user: { icon: Users, label: 'User', color: 'bg-amber-100 text-amber-700' },
} as const;

export default function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const { activeEnvironment } = useContextStore();
  const environmentId = activeEnvironment?.id;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      // Small delay to let the modal render
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim() || !environmentId) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const allResults: SearchResult[] = [];

      try {
        // Search devices
        const devicesPromise = apiClient
          .get<{ devices: Array<{ id: string; serial_number: string | null; model: string | null; manufacturer: string | null }> }>(
            `/api/devices/list?environment_id=${environmentId}&search=${encodeURIComponent(searchQuery)}&per_page=5`,
          )
          .then((res) => {
            for (const d of res.devices ?? []) {
              allResults.push({
                id: d.id,
                name: [d.manufacturer, d.model, d.serial_number].filter(Boolean).join(' ') || d.id,
                category: 'device',
                path: `/devices/${d.id}`,
              });
            }
          })
          .catch(() => {});

        // Search policies
        const policiesPromise = apiClient
          .get<{ policies: Array<{ id: string; name: string }> }>(
            `/api/policies/list?environment_id=${environmentId}`,
          )
          .then((res) => {
            const lowerQ = searchQuery.toLowerCase();
            for (const p of res.policies ?? []) {
              if (p.name.toLowerCase().includes(lowerQ)) {
                allResults.push({
                  id: p.id,
                  name: p.name,
                  category: 'policy',
                  path: `/policies/${p.id}`,
                });
              }
            }
          })
          .catch(() => {});

        // Search groups
        const groupsPromise = apiClient
          .get<{ groups: Array<{ id: string; name: string }> }>(
            `/api/groups/list?environment_id=${environmentId}`,
          )
          .then((res) => {
            const lowerQ = searchQuery.toLowerCase();
            for (const g of res.groups ?? []) {
              if (g.name.toLowerCase().includes(lowerQ)) {
                allResults.push({
                  id: g.id,
                  name: g.name,
                  category: 'group',
                  path: `/groups`,
                });
              }
            }
          })
          .catch(() => {});

        // Search users
        const usersPromise = apiClient
          .get<{ users: Array<{ id: string; email: string; first_name: string | null; last_name: string | null }> }>(
            `/api/users/list?environment_id=${environmentId}`,
          )
          .then((res) => {
            const lowerQ = searchQuery.toLowerCase();
            for (const u of res.users ?? []) {
              const displayName = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email;
              if (displayName.toLowerCase().includes(lowerQ) || u.email.toLowerCase().includes(lowerQ)) {
                allResults.push({
                  id: u.id,
                  name: displayName,
                  category: 'user',
                  path: `/users`,
                });
              }
            }
          })
          .catch(() => {});

        await Promise.all([devicesPromise, policiesPromise, groupsPromise, usersPromise]);
        setResults(allResults);
        setActiveIndex(0);
      } catch {
        // Silently handle errors
      } finally {
        setLoading(false);
      }
    },
    [environmentId],
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      performSearch(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, performSearch]);

  const handleSelect = (result: SearchResult) => {
    navigate(result.path);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[activeIndex]) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    }
  };

  if (!open) return null;

  // Group results by category
  const grouped = results.reduce(
    (acc, result) => {
      if (!acc[result.category]) acc[result.category] = [];
      acc[result.category].push(result);
      return acc;
    },
    {} as Record<string, SearchResult[]>,
  );

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40"
      onClick={onClose}
      data-testid="global-search-backdrop"
    >
      <div
        className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Global search"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200">
          <Search className="h-5 w-5 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search devices, policies, groups, users..."
            className="flex-1 text-sm text-gray-900 placeholder:text-gray-400 bg-transparent outline-none"
            data-testid="global-search-input"
          />
          {loading && <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />}
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {!query.trim() && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Start typing to search across your environment...
            </div>
          )}

          {query.trim() && !loading && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No results found for &ldquo;{query}&rdquo;
            </div>
          )}

          {Object.entries(grouped).map(([category, items]) => {
            const config = CATEGORY_CONFIG[category as keyof typeof CATEGORY_CONFIG];
            return (
              <div key={category}>
                <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                  {config.label}s
                </div>
                {items.map((result) => {
                  flatIndex++;
                  const idx = flatIndex;
                  const Icon = config.icon;
                  return (
                    <button
                      key={result.id}
                      onClick={() => handleSelect(result)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        idx === activeIndex ? 'bg-gray-100' : 'hover:bg-gray-50'
                      }`}
                      data-testid="global-search-result"
                    >
                      <Icon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="flex-1 text-sm text-gray-900 truncate">{result.name}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.color}`}
                      >
                        {config.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-200 flex items-center gap-4 text-xs text-gray-400">
          <span>
            <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-mono">&#8593;</kbd>
            <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-mono ml-0.5">&#8595;</kbd>
            <span className="ml-1">Navigate</span>
          </span>
          <span>
            <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-mono">Enter</kbd>
            <span className="ml-1">Select</span>
          </span>
          <span>
            <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-mono">Esc</kbd>
            <span className="ml-1">Close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
