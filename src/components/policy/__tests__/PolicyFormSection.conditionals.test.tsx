import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PolicyFormSection from '@/components/policy/PolicyFormSection';

function applyPath(config: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let current = config;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!child || typeof child !== 'object' || Array.isArray(child)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}

describe('PolicyFormSection conditional fields', () => {
  it('disables and blanks inapplicable display settings without synthesizing zero values', () => {
    render(
      <PolicyFormSection
        category="screenLock"
        config={{
          displaySettings: {
            screenTimeoutSettings: {
              screenTimeoutMode: 'SCREEN_TIMEOUT_USER_CHOICE',
              screenTimeout: '30s',
            },
            screenBrightnessSettings: {
              screenBrightnessMode: 'BRIGHTNESS_USER_CHOICE',
              screenBrightness: 100,
            },
          },
        }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText('Screen Timeout Duration')).toBeDisabled();
    expect(screen.getByLabelText('Screen Timeout Duration')).toHaveValue('');
    expect(screen.getByLabelText('Screen Brightness (1-255)')).toBeDisabled();
    expect(screen.getByLabelText('Screen Brightness (1-255)')).toHaveValue(null);
  });

  it('clears stale display settings when their controlling mode changes', () => {
    const onChange = vi.fn();
    const savedConfig: Record<string, unknown> = {
      displaySettings: {
        screenTimeoutSettings: {
          screenTimeoutMode: 'SCREEN_TIMEOUT_ENFORCED',
          screenTimeout: '30s',
        },
        screenBrightnessSettings: {
          screenBrightnessMode: 'BRIGHTNESS_FIXED',
          screenBrightness: 100,
        },
      },
    };
    const handleChange = (path: string, value: unknown) => {
      onChange(path, value);
      applyPath(savedConfig, path, value);
    };
    render(
      <PolicyFormSection
        category="screenLock"
        config={savedConfig}
        onChange={handleChange}
      />,
    );

    fireEvent.click(screen.getAllByRole('radio', { name: /^User Choice$/ })[0]);
    expect(onChange).toHaveBeenCalledWith('displaySettings.screenTimeoutSettings.screenTimeout', undefined);

    const brightnessUserChoice = screen.getAllByRole('radio', { name: /^User Choice$/ }).at(-1);
    fireEvent.click(brightnessUserChoice!);
    expect(onChange).toHaveBeenCalledWith('displaySettings.screenBrightnessSettings.screenBrightness', undefined);

    const serialized = JSON.parse(JSON.stringify(savedConfig));
    expect(serialized.displaySettings.screenTimeoutSettings).not.toHaveProperty('screenTimeout');
    expect(serialized.displaySettings.screenBrightnessSettings).not.toHaveProperty('screenBrightness');
  });

  it('keeps applicable display values editable', () => {
    render(
      <PolicyFormSection
        category="screenLock"
        config={{
          displaySettings: {
            screenTimeoutSettings: {
              screenTimeoutMode: 'SCREEN_TIMEOUT_ENFORCED',
              screenTimeout: '45s',
            },
            screenBrightnessSettings: {
              screenBrightnessMode: 'BRIGHTNESS_FIXED',
              screenBrightness: 120,
            },
          },
        }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText('Screen Timeout Duration')).toBeEnabled();
    expect(screen.getByLabelText('Screen Timeout Duration')).toHaveValue('45s');
    expect(screen.getByLabelText('Screen Brightness (1-255)')).toBeEnabled();
    expect(screen.getByLabelText('Screen Brightness (1-255)')).toHaveValue(120);
  });

  it('disables and clears dependent private DNS, VPN, and proxy values', () => {
    const onChange = vi.fn();
    const savedConfig: Record<string, unknown> = {
      alwaysOnVpnPackage: { packageName: 'com.example.vpn', lockdownEnabled: true },
      deviceConnectivityManagement: {
        privateDnsSettings: {
          privateDnsMode: 'PRIVATE_DNS_SPECIFIED_HOST',
          privateDnsHost: 'dns.example.com',
        },
      },
      recommendedGlobalProxy: { host: 'proxy.example.com', port: 8080 },
    };
    const handleChange = (path: string, value: unknown) => {
      onChange(path, value);
      applyPath(savedConfig, path, value);
    };
    const { rerender } = render(
      <PolicyFormSection
        category="network"
        config={{
          alwaysOnVpnPackage: { lockdownEnabled: true },
          deviceConnectivityManagement: {
            privateDnsSettings: {
              privateDnsMode: 'PRIVATE_DNS_AUTOMATIC',
              privateDnsHost: 'stale.example.com',
            },
          },
          recommendedGlobalProxy: { port: 8080 },
        }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText('Always-On VPN Lockdown')).toBeDisabled();
    expect(screen.getByLabelText('Private DNS Host')).toBeDisabled();
    expect(screen.getByLabelText('Private DNS Host')).toHaveValue('');
    expect(screen.getByLabelText('Recommended Global Proxy Port')).toBeDisabled();
    expect(screen.getByLabelText('Recommended Global Proxy Port')).toHaveValue(null);

    rerender(
      <PolicyFormSection
        category="network"
        config={savedConfig}
        onChange={handleChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Always-On VPN Package'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('alwaysOnVpnPackage.lockdownEnabled', undefined);

    fireEvent.click(screen.getByRole('radio', { name: 'Automatic' }));
    expect(onChange).toHaveBeenCalledWith('deviceConnectivityManagement.privateDnsSettings.privateDnsHost', undefined);

    fireEvent.change(screen.getByLabelText('Recommended Global Proxy Host'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('recommendedGlobalProxy.port', undefined);

    const serialized = JSON.parse(JSON.stringify(savedConfig));
    expect(serialized.alwaysOnVpnPackage).not.toHaveProperty('lockdownEnabled');
    expect(serialized.deviceConnectivityManagement.privateDnsSettings).not.toHaveProperty('privateDnsHost');
    expect(serialized.recommendedGlobalProxy).not.toHaveProperty('port');
  });

  it('keeps enabled unset numeric dependents blank and serializes a cleared value as absent', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PolicyFormSection
        category="network"
        config={{ recommendedGlobalProxy: { host: 'proxy.example.com' } }}
        onChange={onChange}
      />,
    );

    const port = screen.getByLabelText('Recommended Global Proxy Port');
    expect(port).toHaveValue(null);
    rerender(
      <PolicyFormSection
        category="network"
        config={{ recommendedGlobalProxy: { host: 'proxy.example.com', port: 8443 } }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Recommended Global Proxy Port'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('recommendedGlobalProxy.port', undefined);
  });

  it('preserves applicable private DNS, VPN, and proxy values on load', () => {
    render(
      <PolicyFormSection
        category="network"
        config={{
          alwaysOnVpnPackage: { packageName: 'com.example.vpn', lockdownEnabled: true },
          deviceConnectivityManagement: {
            privateDnsSettings: {
              privateDnsMode: 'PRIVATE_DNS_SPECIFIED_HOST',
              privateDnsHost: 'dns.example.com',
            },
          },
          recommendedGlobalProxy: { host: 'proxy.example.com', port: 8080 },
        }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText('Always-On VPN Lockdown')).toBeEnabled();
    expect(screen.getByLabelText('Always-On VPN Lockdown')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Private DNS Host')).toBeEnabled();
    expect(screen.getByLabelText('Private DNS Host')).toHaveValue('dns.example.com');
    expect(screen.getByLabelText('Recommended Global Proxy Port')).toBeEnabled();
    expect(screen.getByLabelText('Recommended Global Proxy Port')).toHaveValue(8080);
  });
});
