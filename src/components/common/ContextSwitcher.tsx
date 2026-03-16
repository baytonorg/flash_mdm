import { useContextStore } from '@/stores/context';

function StaticValue({ value }: { value: string }) {
  return (
    <div className="mt-1 w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-gray-50 text-gray-700">
      {value}
    </div>
  );
}

export default function ContextSwitcher() {
  const {
    workspaces, activeWorkspace, switchWorkspace,
    environments, activeEnvironment, switchEnvironment,
    groups, activeGroup, switchGroup,
  } = useContextStore();

  return (
    <div className="space-y-2">
      {/* Workspace */}
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Workspace</label>
        {workspaces.length <= 1 ? (
          <StaticValue value={activeWorkspace?.name ?? workspaces[0]?.name ?? 'No workspaces'} />
        ) : (
          <select
            value={activeWorkspace?.id ?? ''}
            onChange={(e) => switchWorkspace(e.target.value)}
            className="mt-1 w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
          >
            <option value="">Select workspace...</option>
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Environment */}
      {activeWorkspace && (
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Environment</label>
          {environments.length <= 1 ? (
            <StaticValue value={
              activeEnvironment
                ? `${activeEnvironment.name}${activeEnvironment.enterprise_name ? ` (${activeEnvironment.enterprise_name.replace('enterprises/', '')})` : ''}`
                : environments[0]
                ? `${environments[0].name}${environments[0].enterprise_name ? ` (${environments[0].enterprise_name.replace('enterprises/', '')})` : ''}`
                : 'No environments'
            } />
          ) : (
            <select
              value={activeEnvironment?.id ?? ''}
              onChange={(e) => switchEnvironment(e.target.value)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            >
              <option value="">Select environment...</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                  {env.enterprise_name ? ` (${env.enterprise_name.replace('enterprises/', '')})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Group */}
      {activeEnvironment && groups.length > 0 && (
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Group</label>
          {groups.length === 1 ? (
            <StaticValue value={groups[0].name} />
          ) : (
            <select
              value={activeGroup?.id ?? ''}
              onChange={(e) => switchGroup(e.target.value)}
              className="mt-1 w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            >
              <option value="">All groups</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.depth ? '\u00A0'.repeat(g.depth * 2) + '— ' : ''}{g.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
