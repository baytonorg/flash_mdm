import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import PlayStoreIframe from '@/components/apps/PlayStoreIframe';

function mockGapi() {
  window.gapi = {
    load: (_moduleName: string, callback: () => void) => callback(),
    iframes: {
      getContext: () => ({
        openChild: () => ({
          register: vi.fn(),
          close: vi.fn(),
        }),
      }),
      CROSS_ORIGIN_IFRAMES_FILTER: {},
    },
  };
}

describe('PlayStoreIframe origin validation', () => {
  beforeEach(() => {
    mockGapi();
  });

  afterEach(() => {
    delete window.gapi;
  });

  it('accepts postMessage events only from the exact iframe origin', async () => {
    const onAppSelected = vi.fn();

    render(
      <PlayStoreIframe
        token="token_123"
        url="https://play.google.com/work/apps/details?id=com.example.app"
        onAppSelected={onAppSelected}
      />
    );

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://play.google.com',
      data: {
        event: 'onproductselect',
        action: 'selected',
        packageName: 'com.example.app',
      },
    }));

    await waitFor(() => {
      expect(onAppSelected).toHaveBeenCalledWith('com.example.app');
    });
  });

  it('rejects spoofed origins that merely contain play.google.com', async () => {
    const onAppSelected = vi.fn();

    render(
      <PlayStoreIframe
        token="token_123"
        url="https://play.google.com/work/apps/details?id=com.example.app"
        onAppSelected={onAppSelected}
      />
    );

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://play.google.com.evil.example',
      data: {
        event: 'onproductselect',
        action: 'selected',
        packageName: 'com.example.app',
      },
    }));

    await waitFor(() => {
      expect(onAppSelected).not.toHaveBeenCalled();
    });
  });
});
