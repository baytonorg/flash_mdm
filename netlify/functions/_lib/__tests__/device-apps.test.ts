import { describe, expect, it } from 'vitest';
import { deriveDeviceApplicationsFromSnapshot } from '../device-apps.js';

describe('deriveDeviceApplicationsFromSnapshot', () => {
  it('maps snapshot.applicationReports into device app inventory rows', () => {
    const rows = deriveDeviceApplicationsFromSnapshot({
      applicationReports: [
        {
          packageName: 'com.zed',
          displayName: 'Zed App',
          versionName: '1.2.3',
          versionCode: 123,
          state: 'INSTALLED',
          applicationSource: 'PLAY_STORE',
        },
        {
          packageName: 'com.alpha',
          displayName: 'Alpha',
          versionCode: 1,
          state: 'REMOVED',
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      package_name: 'com.alpha',
      display_name: 'Alpha',
      version_code: 1,
      state: 'REMOVED',
      icon_url: null,
    });
    expect(rows[1]).toMatchObject({
      package_name: 'com.zed',
      display_name: 'Zed App',
      version_name: '1.2.3',
      version_code: 123,
      state: 'INSTALLED',
      source: 'PLAY_STORE',
      icon_url: null,
    });
  });

  it('handles JSON string snapshots and skips malformed rows', () => {
    const rows = deriveDeviceApplicationsFromSnapshot(JSON.stringify({
      applicationReports: [
        { packageName: 'com.good' },
        { displayName: 'Missing package' },
      ],
    }));

    expect(rows).toEqual([
      expect.objectContaining({
        package_name: 'com.good',
        display_name: null,
      }),
    ]);
  });
});
