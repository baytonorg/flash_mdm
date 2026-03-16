export interface AppMetadataCacheRowLike {
  package_name: string;
  display_name: string;
  icon_url: string | null;
}

export interface HydratedAppMetadata {
  title: string | null;
  icon_url: string | null;
}

export function needsAppMetadataHydration(app: AppMetadataCacheRowLike): boolean {
  const display = app.display_name?.trim();
  return !app.icon_url || !display || display === app.package_name;
}

export function mergeHydratedAppMetadata<T extends AppMetadataCacheRowLike>(
  app: T,
  meta: HydratedAppMetadata | null,
): T {
  if (!meta) return app;

  const nextDisplayName =
    app.display_name && app.display_name.trim() && app.display_name !== app.package_name
      ? app.display_name
      : (meta.title ?? app.display_name);
  const nextIconUrl = app.icon_url ?? meta.icon_url;

  if (nextDisplayName === app.display_name && nextIconUrl === app.icon_url) return app;
  return { ...app, display_name: nextDisplayName, icon_url: nextIconUrl };
}
