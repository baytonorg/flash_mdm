import { useCallback, useMemo } from 'react';
import { APIProvider, Map, useMap, AdvancedMarker } from '@vis.gl/react-google-maps';
import type { Geofence } from '@/api/queries/geofences';
import { MapPin } from 'lucide-react';

// Circle overlay component using Maps JavaScript API directly
function GeofenceCircle({
  geofence,
  isSelected,
  onClick,
}: {
  geofence: Geofence;
  isSelected: boolean;
  onClick?: (id: string) => void;
}) {
  const map = useMap();

  // Draw circle using the Google Maps Circle class
  useMemo(() => {
    if (!map || !window.google?.maps) return undefined;

    const circle = new google.maps.Circle({
      map,
      center: { lat: geofence.latitude, lng: geofence.longitude },
      radius: geofence.radius_meters,
      fillColor: geofence.enabled ? (isSelected ? '#2563eb' : '#3b82f6') : '#9ca3af',
      fillOpacity: isSelected ? 0.3 : 0.15,
      strokeColor: geofence.enabled ? (isSelected ? '#1d4ed8' : '#3b82f6') : '#6b7280',
      strokeOpacity: 0.8,
      strokeWeight: isSelected ? 3 : 2,
      clickable: true,
    });

    circle.addListener('click', () => {
      onClick?.(geofence.id);
    });

    return () => {
      circle.setMap(null);
    };
  }, [map, geofence.id, geofence.latitude, geofence.longitude, geofence.radius_meters, geofence.enabled, isSelected, onClick]);

  return null;
}

// Device marker component
function DeviceMarker({ lat, lng, label }: { lat: number; lng: number; label?: string }) {
  return (
    <AdvancedMarker position={{ lat, lng }}>
      <div className="relative group">
        <div className="w-6 h-6 bg-green-500 border-2 border-white rounded-full shadow-md flex items-center justify-center">
          <div className="w-2 h-2 bg-white rounded-full" />
        </div>
        {label && (
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            {label}
          </div>
        )}
      </div>
    </AdvancedMarker>
  );
}

interface DeviceLocation {
  id: string;
  latitude: number;
  longitude: number;
  name?: string;
}

interface GeofenceMapProps {
  geofences: Geofence[];
  selectedId?: string | null;
  onGeofenceClick?: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  devices?: DeviceLocation[];
  previewCircle?: { lat: number; lng: number; radius: number } | null;
  className?: string;
}

function MapContent({
  geofences,
  selectedId,
  onGeofenceClick,
  onMapClick,
  devices,
  previewCircle,
}: Omit<GeofenceMapProps, 'className'>) {
  const map = useMap();

  // Draw preview circle
  useMemo(() => {
    if (!map || !window.google?.maps || !previewCircle) return undefined;

    const circle = new google.maps.Circle({
      map,
      center: { lat: previewCircle.lat, lng: previewCircle.lng },
      radius: previewCircle.radius,
      fillColor: '#f59e0b',
      fillOpacity: 0.2,
      strokeColor: '#d97706',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      clickable: false,
    });

    return () => {
      circle.setMap(null);
    };
  }, [map, previewCircle?.lat, previewCircle?.lng, previewCircle?.radius]);

  return (
    <>
      {geofences.map((geofence) => (
        <GeofenceCircle
          key={geofence.id}
          geofence={geofence}
          isSelected={geofence.id === selectedId}
          onClick={onGeofenceClick}
        />
      ))}
      {devices?.map((device) => (
        <DeviceMarker
          key={device.id}
          lat={device.latitude}
          lng={device.longitude}
          label={device.name}
        />
      ))}
    </>
  );
}

export default function GeofenceMap({
  geofences,
  selectedId,
  onGeofenceClick,
  onMapClick,
  devices,
  previewCircle,
  className = '',
}: GeofenceMapProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  // Calculate center based on geofences or default
  const center = useMemo(() => {
    if (previewCircle) {
      return { lat: previewCircle.lat, lng: previewCircle.lng };
    }
    const selected = geofences.find((g) => g.id === selectedId);
    if (selected) {
      return { lat: selected.latitude, lng: selected.longitude };
    }
    if (geofences.length > 0) {
      const avgLat = geofences.reduce((sum, g) => sum + g.latitude, 0) / geofences.length;
      const avgLng = geofences.reduce((sum, g) => sum + g.longitude, 0) / geofences.length;
      return { lat: avgLat, lng: avgLng };
    }
    // Default to center of the world
    return { lat: 20, lng: 0 };
  }, [geofences, selectedId, previewCircle]);

  const handleMapClick = useCallback(
    (event: { detail: { latLng?: google.maps.LatLngLiteral | null } }) => {
      if (onMapClick && event.detail.latLng) {
        onMapClick(event.detail.latLng.lat, event.detail.latLng.lng);
      }
    },
    [onMapClick]
  );

  // Fallback when no API key is set
  if (!apiKey) {
    return (
      <div className={`bg-gray-100 border border-gray-200 rounded-lg flex flex-col items-center justify-center gap-3 ${className}`}>
        <MapPin className="h-12 w-12 text-gray-300" />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-600">Google Maps not configured</p>
          <p className="text-xs text-gray-500 mt-1">
            Set <code className="bg-gray-200 px-1 py-0.5 rounded">VITE_GOOGLE_MAPS_API_KEY</code> in your environment to enable the map.
          </p>
        </div>
        {geofences.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            {geofences.length} geofence{geofences.length !== 1 ? 's' : ''} configured
          </div>
        )}
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <div className={`rounded-lg overflow-hidden ${className}`}>
        <Map
          defaultCenter={center}
          defaultZoom={geofences.length > 0 ? 12 : 3}
          mapId="geofence-map"
          gestureHandling="greedy"
          disableDefaultUI={false}
          onClick={handleMapClick}
          style={{ width: '100%', height: '100%' }}
        >
          <MapContent
            geofences={geofences}
            selectedId={selectedId}
            onGeofenceClick={onGeofenceClick}
            onMapClick={onMapClick}
            devices={devices}
            previewCircle={previewCircle}
          />
        </Map>
      </div>
    </APIProvider>
  );
}
