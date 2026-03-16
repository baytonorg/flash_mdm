/**
 * Haversine distance calculation and geofencing utilities.
 * Shared between frontend and backend (duplicated for ESM compatibility).
 */

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculate the distance in meters between two geographic coordinates
 * using the Haversine formula.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Check if a device coordinate is inside a circular geofence.
 */
export function isInsideCircle(
  deviceLat: number,
  deviceLon: number,
  fenceLat: number,
  fenceLon: number,
  radiusMeters: number
): boolean {
  return haversineDistance(deviceLat, deviceLon, fenceLat, fenceLon) < radiusMeters;
}

/**
 * Check if a point is inside a polygon using the ray-casting algorithm.
 * Polygon is an array of {lat, lng} vertices.
 */
export function isInsidePolygon(
  deviceLat: number,
  deviceLon: number,
  polygon: Array<{ lat: number; lng: number }>
): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;

    const intersect =
      yi > deviceLon !== yj > deviceLon &&
      deviceLat < ((xj - xi) * (deviceLon - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}
