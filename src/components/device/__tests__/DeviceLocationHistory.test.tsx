import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import DeviceLocationHistory from '../DeviceLocationHistory';

describe('DeviceLocationHistory', () => {
  it('renders map preview and map links for each location entry', () => {
    render(
      <DeviceLocationHistory
        locations={[
          {
            latitude: 51.597643,
            longitude: -3.073585,
            accuracy: null,
            recorded_at: '2026-03-03T17:58:49.000Z',
          },
        ]}
      />
    );

    const mapPreview = screen.getByAltText('Map preview for 51.597643, -3.073585');
    expect(mapPreview).toBeInTheDocument();
    expect(mapPreview).toHaveAttribute('src', expect.stringContaining('maps.googleapis.com/maps/api/staticmap'));
    expect(mapPreview).toHaveAttribute('srcset', expect.stringContaining('scale=2'));

    expect(screen.getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute(
      'href',
      expect.stringContaining('www.google.com/maps/search/?api=1&query=51.597643%2C-3.073585')
    );
  });
});
