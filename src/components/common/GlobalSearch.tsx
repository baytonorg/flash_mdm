import { useState, useEffect, useRef } from 'react';
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

type SearchCategory = SearchResult['category'];
type SearchStatus = 'idle' | 'loading' | 'complete' | 'partial' | 'error';

interface SearchState {
  key: string;
  status: SearchStatus;
  results: SearchResult[];
  failedCategories: SearchCategory[];
}

const EMPTY_SEARCH_STATE: SearchState = {
  key: '',
  status: 'idle',
  results: [],
  failedCategories: [],
};

const CATEGORY_CONFIG = {
  device: { icon: Smartphone, label: 'Device', pluralLabel: 'Devices', color: 'bg-blue-100 text-blue-700' },
  policy: { icon: Shield, label: 'Policy', pluralLabel: 'Policies', color: 'bg-purple-100 text-purple-700' },
  group: { icon: FolderTree, label: 'Group', pluralLabel: 'Groups', color: 'bg-green-100 text-green-700' },
  user: { icon: Users, label: 'User', pluralLabel: 'Users', color: 'bg-amber-100 text-amber-700' },
} as const;

export default function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const { activeEnvironment } = useContextStore();
  const environmentId = activeEnvironment?.id;

  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>(EMPTY_SEARCH_STATE);
  const [activeIndex, setActiveIndex] = useState(0);
  const [retryVersion, setRetryVersion] = useState(0);
  const searchSequenceRef = useRef(0);

  const trimmedQuery = query.trim();
  const currentSearchKey = open && environmentId && trimmedQuery
    ? `${environmentId}\u0000${trimmedQuery}`
    : '';
  const visibleState = searchState.key === currentSearchKey
    ? searchState
    : {
        key: currentSearchKey,
        status: currentSearchKey ? 'loading' as const : 'idle' as const,
        results: [],
        failedCategories: [],
      };
  const { results, failedCategories, status } = visibleState;
  const loading = status === 'loading';

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setQuery('');
      setSearchState(EMPTY_SEARCH_STATE);
      setActiveIndex(0);
      const focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(focusTimer);
    }
  }, [open]);

  useEffect(() => {
    const sequence = ++searchSequenceRef.current;

    if (!currentSearchKey || !environmentId) {
      setSearchState(EMPTY_SEARCH_STATE);
      setActiveIndex(0);
      return;
    }

    const controller = new AbortController();
    setSearchState({
      key: currentSearchKey,
      status: 'loading',
      results: [],
      failedCategories: [],
    });
    setActiveIndex(0);

    const debounceTimer = setTimeout(async () => {
      const requestOptions = { signal: controller.signal };
      const lowerQuery = trimmedQuery.toLowerCase();
      const searches: Array<{ category: SearchCategory; promise: Promise<SearchResult[]> }> = [
        {
          category: 'device',
          promise: apiClient
            .get<{ devices: Array<{ id: string; serial_number: string | null; model: string | null; manufacturer: string | null }> }>(
              `/api/devices/list?environment_id=${environmentId}&search=${encodeURIComponent(trimmedQuery)}&per_page=5`,
              requestOptions,
            )
            .then((response) => (response.devices ?? []).map((device) => ({
              id: device.id,
              name: [device.manufacturer, device.model, device.serial_number].filter(Boolean).join(' ') || device.id,
              category: 'device' as const,
              path: `/devices/${device.id}`,
            }))),
        },
        {
          category: 'policy',
          promise: apiClient
            .get<{ policies: Array<{ id: string; name: string }> }>(
              `/api/policies/list?environment_id=${environmentId}`,
              requestOptions,
            )
            .then((response) => (response.policies ?? [])
              .filter((policy) => policy.name.toLowerCase().includes(lowerQuery))
              .map((policy) => ({
                id: policy.id,
                name: policy.name,
                category: 'policy' as const,
                path: `/policies/${policy.id}`,
              }))),
        },
        {
          category: 'group',
          promise: apiClient
            .get<{ groups: Array<{ id: string; name: string }> }>(
              `/api/groups/list?environment_id=${environmentId}`,
              requestOptions,
            )
            .then((response) => (response.groups ?? [])
              .filter((group) => group.name.toLowerCase().includes(lowerQuery))
              .map((group) => ({
                id: group.id,
                name: group.name,
                category: 'group' as const,
                path: '/groups',
              }))),
        },
        {
          category: 'user',
          promise: apiClient
            .get<{ users: Array<{ id: string; email: string; first_name: string | null; last_name: string | null }> }>(
              `/api/users/list?environment_id=${environmentId}`,
              requestOptions,
            )
            .then((response) => (response.users ?? []).flatMap((user) => {
              const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
              return displayName.toLowerCase().includes(lowerQuery) || user.email.toLowerCase().includes(lowerQuery)
                ? [{
                    id: user.id,
                    name: displayName,
                    category: 'user' as const,
                    path: '/users',
                  }]
                : [];
            })),
        },
      ];

      const settled = await Promise.allSettled(searches.map((search) => search.promise));
      if (controller.signal.aborted || sequence !== searchSequenceRef.current) return;

      const nextResults: SearchResult[] = [];
      const nextFailedCategories: SearchCategory[] = [];
      settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
          nextResults.push(...outcome.value);
        } else {
          nextFailedCategories.push(searches[index].category);
        }
      });

      setSearchState({
        key: currentSearchKey,
        status: nextFailedCategories.length === searches.length
          ? 'error'
          : nextFailedCategories.length > 0
            ? 'partial'
            : 'complete',
        results: nextResults,
        failedCategories: nextFailedCategories,
      });
      setActiveIndex(0);
    }, 300);

    return () => {
      clearTimeout(debounceTimer);
      controller.abort();
    };
  }, [currentSearchKey, environmentId, retryVersion, trimmedQuery]);

  const failedCategoryLabels = failedCategories
    .map((category) => CATEGORY_CONFIG[category].pluralLabel)
    .join(', ');

  const handleRetry = () => {
    setRetryVersion((version) => version + 1);
  };

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
        aria-modal="true"
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
            aria-label="Search devices, policies, groups, and users"
            placeholder="Search devices, policies, groups, users..."
            className="flex-1 text-sm text-gray-900 placeholder:text-gray-400 bg-transparent outline-none"
            data-testid="global-search-input"
          />
          {loading && (
            <span role="status" className="flex items-center">
              <Loader2 className="h-4 w-4 text-gray-400 animate-spin" aria-hidden="true" />
              <span className="sr-only">Searching</span>
            </span>
          )}
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto" aria-busy={loading}>
          {!trimmedQuery && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              Start typing to search across your environment...
            </div>
          )}

          {status === 'complete' && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400" role="status">
              No results found for &ldquo;{trimmedQuery}&rdquo;
            </div>
          )}

          {status === 'partial' && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-amber-800 bg-amber-50" role="status">
              <span>
                {results.length === 0
                  ? 'No matches in available categories. '
                  : ''}
                Some categories could not be searched: {failedCategoryLabels}.
              </span>
              <button
                type="button"
                onClick={handleRetry}
                className="flex-shrink-0 rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium hover:bg-amber-100"
              >
                Retry search
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="px-4 py-6 text-center" role="alert">
              <p className="text-sm text-gray-700">Search is unavailable.</p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-3 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
              >
                Retry
              </button>
            </div>
          )}

          {(status === 'complete' || status === 'partial') && Object.entries(grouped).map(([category, items]) => {
            const config = CATEGORY_CONFIG[category as keyof typeof CATEGORY_CONFIG];
            return (
              <div key={category}>
                <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                  {config.pluralLabel}
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
