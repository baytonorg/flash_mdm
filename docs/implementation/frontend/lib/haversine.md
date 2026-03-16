# `src/lib/haversine.ts`

> Geospatial utilities: Haversine distance calculation, circular geofence check, and polygon point-in-polygon test.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `haversineDistance` | `(lat1: number, lon1: number, lat2: number, lon2: number) => number` | Returns distance in meters between two coordinates using the Haversine formula |
| `isInsideCircle` | `(deviceLat: number, deviceLon: number, fenceLat: number, fenceLon: number, radiusMeters: number) => boolean` | Checks if a point is inside a circular geofence |
| `isInsidePolygon` | `(deviceLat: number, deviceLon: number, polygon: Array<{ lat: number; lng: number }>) => boolean` | Checks if a point is inside a polygon using ray-casting |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `toRadians` | 8-10 | Converts degrees to radians |

## Key Logic

- **Haversine formula**: Uses Earth radius of 6,371,000 meters. Computes the great-circle distance between two lat/lon pairs.
- **Circle check**: Delegates to `haversineDistance` and returns `true` if distance is strictly less than `radiusMeters`.
- **Polygon check**: Implements the ray-casting algorithm. Iterates over polygon edges and counts crossings to determine inside/outside. Returns `false` for polygons with fewer than 3 vertices.
- This file is duplicated between frontend and backend for ESM compatibility (noted in source comments).
