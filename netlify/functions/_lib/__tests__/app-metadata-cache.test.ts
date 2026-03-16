import { describe, expect, it } from 'vitest';
import { mergeHydratedAppMetadata, needsAppMetadataHydration } from '../app-metadata-cache.js';

describe('app metadata cache helpers', () => {
  it('hydrates when icon is missing', () => {
    expect(needsAppMetadataHydration({
      package_name: 'com.example.app',
      display_name: 'Example App',
      icon_url: null,
    })).toBe(true);
  });

  it('hydrates when display name is just the package name placeholder', () => {
    expect(needsAppMetadataHydration({
      package_name: 'com.linkedin.android',
      display_name: 'com.linkedin.android',
      icon_url: 'https://example/icon.png',
    })).toBe(true);
  });

  it('does not overwrite a custom display name when merging AMAPI metadata', () => {
    const row = {
      package_name: 'com.example.app',
      display_name: 'Sales Tablets',
      icon_url: null,
    };

    expect(mergeHydratedAppMetadata(row, {
      title: 'Example App',
      icon_url: 'https://example/icon.png',
    })).toEqual({
      package_name: 'com.example.app',
      display_name: 'Sales Tablets',
      icon_url: 'https://example/icon.png',
    });
  });

  it('replaces placeholder display name and fills icon from AMAPI metadata', () => {
    const row = {
      package_name: 'com.linkedin.android',
      display_name: 'com.linkedin.android',
      icon_url: null,
    };

    expect(mergeHydratedAppMetadata(row, {
      title: 'LinkedIn',
      icon_url: 'https://example/linkedin.png',
    })).toEqual({
      package_name: 'com.linkedin.android',
      display_name: 'LinkedIn',
      icon_url: 'https://example/linkedin.png',
    });
  });
});
