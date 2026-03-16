import { useState, useEffect } from 'react';
import { useSignupLink, useCreateSignupLink, useUpdateSignupLink, useDeleteSignupLink } from '@/api/queries/signupLinks';
import ConfirmModal from '@/components/common/ConfirmModal';
import { Copy, Check, AlertCircle, Loader2, RefreshCw, Link2, Trash2 } from 'lucide-react';
import clsx from 'clsx';
interface EnvironmentLike {
  id: string;
  name: string;
}

interface GroupLike {
  id: string;
  name: string;
}

interface SignupLinkSettingsProps {
  scopeType: 'workspace' | 'environment';
  scopeId: string;
  environments?: EnvironmentLike[];
  groups?: GroupLike[];
  purpose?: 'standard' | 'customer';
  title?: string;
  description?: string;
}

function FeedbackMessage({ success, error }: { success?: string; error?: string }) {
  if (success) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        <Check className="h-4 w-4" />
        {success}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }
  return null;
}

export default function SignupLinkSettings({
  scopeType,
  scopeId,
  environments,
  groups,
  purpose = 'standard',
  title,
  description,
}: SignupLinkSettingsProps) {
  const { data: link, isLoading } = useSignupLink(scopeType, scopeId, purpose);
  const createLink = useCreateSignupLink();
  const updateLink = useUpdateSignupLink();
  const deleteLink = useDeleteSignupLink();
  const isCustomerPurpose = purpose === 'customer';

  const [feedback, setFeedback] = useState<{ success?: string; error?: string }>({});
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Editable fields
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [displayDescription, setDisplayDescription] = useState('');
  const [defaultRole, setDefaultRole] = useState('viewer');
  const [defaultAccessScope, setDefaultAccessScope] = useState('workspace');
  const [selectedEnvIds, setSelectedEnvIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [allowedDomains, setAllowedDomains] = useState('');

  // Modals
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  // Sync state from fetched link
  useEffect(() => {
    if (link) {
      setSlug(link.slug ?? '');
      setDisplayName(link.display_name ?? '');
      setDisplayDescription(link.display_description ?? '');
      setDefaultRole(link.default_role);
      setDefaultAccessScope(link.default_access_scope);
      setSelectedEnvIds(link.auto_assign_environment_ids ?? []);
      setSelectedGroupIds(link.auto_assign_group_ids ?? []);
      setAllowedDomains((link.allowed_domains ?? []).join(', '));
    }
  }, [link]);

  const parseAllowedDomains = () =>
    allowedDomains
      .split(/[\s,]+/)
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);

  const validateAllowedDomains = (domains: string[]) => {
    for (const domain of domains) {
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
        return `Invalid domain format: ${domain}`;
      }
    }
    return null;
  };

  const baseUrl = window.location.origin;
  const prefix = scopeType === 'workspace' ? '/join/w/' : '/join/e/';

  const getShareUrl = () => {
    if (link?.slug) return `${baseUrl}${prefix}${link.slug}`;
    if (rawToken) return `${baseUrl}${prefix}${rawToken}`;
    return null;
  };

  const handleCopy = async () => {
    const url = getShareUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreate = async () => {
    setFeedback({});
    const domains = parseAllowedDomains();
    const domainError = validateAllowedDomains(domains);
    if (domainError) {
      setFeedback({ error: domainError });
      return;
    }
    try {
      const result = await createLink.mutateAsync({
        scope_type: scopeType,
        scope_id: scopeId,
        purpose,
        slug: slug.trim() || undefined,
        default_role: isCustomerPurpose ? 'viewer' : defaultRole,
        default_access_scope: isCustomerPurpose
          ? 'scoped'
          : scopeType === 'environment'
            ? 'scoped'
            : defaultAccessScope,
        auto_assign_environment_ids: isCustomerPurpose ? [] : selectedEnvIds,
        auto_assign_group_ids: isCustomerPurpose ? [] : selectedGroupIds,
        allow_environment_creation: isCustomerPurpose,
        allowed_domains: domains,
        display_name: displayName.trim() || undefined,
        display_description: displayDescription.trim() || undefined,
      });
      setRawToken(result.token);
      setFeedback({ success: 'Signup link created. Copy the URL before leaving this page.' });
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to create signup link' });
    }
  };

  const handleRegenerate = async () => {
    setShowRegenerate(false);
    setFeedback({});
    const domains = parseAllowedDomains();
    const domainError = validateAllowedDomains(domains);
    if (domainError) {
      setFeedback({ error: domainError });
      return;
    }
    try {
      const result = await createLink.mutateAsync({
        scope_type: scopeType,
        scope_id: scopeId,
        purpose,
        slug: slug.trim() || undefined,
        default_role: isCustomerPurpose ? 'viewer' : defaultRole,
        default_access_scope: isCustomerPurpose
          ? 'scoped'
          : scopeType === 'environment'
            ? 'scoped'
            : defaultAccessScope,
        auto_assign_environment_ids: isCustomerPurpose ? [] : selectedEnvIds,
        auto_assign_group_ids: isCustomerPurpose ? [] : selectedGroupIds,
        allow_environment_creation: isCustomerPurpose,
        allowed_domains: domains,
        display_name: displayName.trim() || undefined,
        display_description: displayDescription.trim() || undefined,
      });
      setRawToken(result.token);
      setFeedback({ success: 'Token regenerated. The old link no longer works. Copy the new URL.' });
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to regenerate link' });
    }
  };

  const handleToggleEnabled = async () => {
    if (!link) return;
    setFeedback({});
    try {
      await updateLink.mutateAsync({ id: link.id, enabled: !link.enabled });
      setFeedback({ success: link.enabled ? 'Signup link disabled.' : 'Signup link enabled.' });
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to update link' });
    }
  };

  const handleSaveSettings = async () => {
    if (!link) return;
    setFeedback({});
    const domains = parseAllowedDomains();
    const domainError = validateAllowedDomains(domains);
    if (domainError) {
      setFeedback({ error: domainError });
      return;
    }
    try {
      await updateLink.mutateAsync({
        id: link.id,
        slug: slug.trim() || null,
        allowed_domains: domains,
        ...(!isCustomerPurpose ? { default_role: defaultRole } : {}),
        ...(scopeType === 'workspace'
          ? {
              ...(isCustomerPurpose ? {} : {
                default_access_scope: defaultAccessScope,
                auto_assign_environment_ids: selectedEnvIds,
                allow_environment_creation: false,
              }),
            }
          : {
              auto_assign_group_ids: selectedGroupIds,
            }),
        display_name: displayName.trim() || null,
        display_description: displayDescription.trim() || null,
      });
      setFeedback({ success: 'Signup link settings updated.' });
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to update settings' });
    }
  };

  const handleDelete = async () => {
    if (!link) return;
    setShowDelete(false);
    setFeedback({});
    try {
      await deleteLink.mutateAsync(link.id);
      setRawToken(null);
      setFeedback({ success: 'Signup link permanently revoked.' });
    } catch (err) {
      setFeedback({ error: err instanceof Error ? err.message : 'Failed to delete link' });
    }
  };

  const toggleEnvId = (id: string) => {
    setSelectedEnvIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleGroupId = (id: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading signup link settings...
      </div>
    );
  }

  const shareUrl = getShareUrl();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-900">
          {title ?? (isCustomerPurpose ? 'Customer Signup Link' : 'Signup Link')}
        </h3>
      </div>
      <p className="text-sm text-gray-500">
        {description ?? (
          isCustomerPurpose
            ? 'Customer onboarding link. New users create and own their first environment without workspace settings visibility.'
            : `Share a link that lets anyone sign up directly into this ${scopeType}. No per-email invites required.`
        )}
      </p>

      <FeedbackMessage {...feedback} />

      {!link ? (
        /* No link exists yet — show creation form */
        <div className="space-y-4 rounded-lg border border-gray-200 p-4">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Custom Slug (optional)</label>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <span className="min-w-0 break-all text-sm text-gray-400">{baseUrl}{prefix}</span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-company"
                  className="w-full sm:flex-1 sm:max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">3-100 characters, lowercase letters, numbers, and hyphens</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Display Name (optional)</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. My Company"
                className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea
                value={displayDescription}
                onChange={(e) => setDisplayDescription(e.target.value)}
                placeholder="Shown on the signup page"
                rows={2}
                className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            {!isCustomerPurpose && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Role</label>
                <select
                  value={defaultRole}
                  onChange={(e) => setDefaultRole(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="viewer">Viewer</option>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Allowed email domains (optional)</label>
              <input
                type="text"
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                placeholder="company.com, subsidiary.org"
                className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <p className="mt-1 text-xs text-gray-500">Restrict signup to specific email domains</p>
            </div>

            {scopeType === 'workspace' && !isCustomerPurpose && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Access Scope</label>
                  <select
                    value={defaultAccessScope}
                    onChange={(e) => setDefaultAccessScope(e.target.value)}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="workspace">Workspace (access all environments)</option>
                    <option value="scoped">Scoped (specific environments only)</option>
                  </select>
                </div>

                {defaultAccessScope === 'scoped' && environments && environments.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Auto-assign Environments</label>
                    <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2">
                      {environments.map((env) => (
                        <label key={env.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedEnvIds.includes(env.id)}
                            onChange={() => toggleEnvId(env.id)}
                            className="rounded border-gray-300"
                          />
                          <span className="text-sm text-gray-700">{env.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {scopeType === 'environment' && groups && groups.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Auto-assign Groups (optional)</label>
                <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2">
                  {groups.map((group) => (
                    <label key={group.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.includes(group.id)}
                        onChange={() => toggleGroupId(group.id)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">{group.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleCreate}
            disabled={createLink.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
          >
            {createLink.isPending ? 'Creating...' : 'Create Signup Link'}
          </button>
        </div>
      ) : (
        /* Link exists — show management UI */
        <div className="space-y-4 rounded-lg border border-gray-200 p-4">
          {/* Enable/Disable toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={clsx(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                link.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
              )}>
                {link.enabled ? 'Active' : 'Disabled'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleToggleEnabled}
              disabled={updateLink.isPending}
              className={clsx(
                'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
                link.enabled
                  ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  : 'border-green-300 text-green-700 hover:bg-green-50'
              )}
            >
              {link.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>

          {/* Share URL */}
          {shareUrl && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Share URL</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 truncate">
                  {shareUrl}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="rounded-lg border border-border bg-surface p-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
                  title="Copy URL"
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              {rawToken && !link.slug && (
                <p className="mt-1 text-xs text-amber-700">
                  This token-based URL is shown once. Save it now or set a custom slug.
                </p>
              )}
            </div>
          )}

          {/* Editable fields */}
          <div className="space-y-3 border-t border-gray-200 pt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Custom Slug</label>
              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                <span className="min-w-0 break-all text-sm text-gray-400">{baseUrl}{prefix}</span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-company"
                  className="w-full sm:flex-1 sm:max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. My Company"
                className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={displayDescription}
                onChange={(e) => setDisplayDescription(e.target.value)}
                placeholder="Shown on the signup page"
                rows={2}
                className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>

            {!isCustomerPurpose && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Default Role</label>
                <select
                  value={defaultRole}
                  onChange={(e) => setDefaultRole(e.target.value)}
                  className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="viewer">Viewer</option>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Allowed email domains (optional)</label>
              <input
                type="text"
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                placeholder="company.com, subsidiary.org"
                className="w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <p className="mt-1 text-xs text-gray-500">Restrict signup to specific email domains</p>
            </div>

            {scopeType === 'workspace' && !isCustomerPurpose && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Access Scope</label>
                  <select
                    value={defaultAccessScope}
                    onChange={(e) => setDefaultAccessScope(e.target.value)}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="workspace">Workspace (access all environments)</option>
                    <option value="scoped">Scoped (specific environments only)</option>
                  </select>
                </div>

                {defaultAccessScope === 'scoped' && environments && environments.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Auto-assign Environments</label>
                    <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2">
                      {environments.map((env) => (
                        <label key={env.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedEnvIds.includes(env.id)}
                            onChange={() => toggleEnvId(env.id)}
                            className="rounded border-gray-300"
                          />
                          <span className="text-sm text-gray-700">{env.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {scopeType === 'environment' && groups && groups.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Auto-assign Groups</label>
                <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 p-2">
                  {groups.map((group) => (
                    <label key={group.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.includes(group.id)}
                        onChange={() => toggleGroupId(group.id)}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm text-gray-700">{group.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={updateLink.isPending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light transition-colors disabled:opacity-50"
            >
              {updateLink.isPending ? 'Saving...' : 'Save Settings'}
            </button>
          </div>

          {/* Danger zone */}
          <div className="border-t border-gray-200 pt-4 space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowRegenerate(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Regenerate Token
              </button>
              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Revoke Link
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={showRegenerate}
        onClose={() => setShowRegenerate(false)}
        onConfirm={handleRegenerate}
        title="Regenerate signup link?"
        message="This will invalidate the current token. Anyone with the old link will no longer be able to sign up. The slug URL will continue to work if set."
        confirmLabel="Regenerate"
        variant="danger"
        loading={createLink.isPending}
      />

      <ConfirmModal
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Revoke signup link?"
        message="This will permanently delete the signup link. No one will be able to sign up using this link. This action cannot be undone."
        confirmLabel="Revoke"
        variant="danger"
        loading={deleteLink.isPending}
      />
    </div>
  );
}
