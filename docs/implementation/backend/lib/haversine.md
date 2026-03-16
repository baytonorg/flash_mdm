# `netlify/functions/_lib/haversine.ts`

> Geofencing utilities: Haversine distance calculation, circular geofence check, and polygon point-in-polygon test.

## Exports

| Name | Type | Description |
|------|------|-------------|
| `haversineDistance` | `(lat1: number, lon1: number, lat2: number, lon2: number) => number` | Returns the distance in meters between two geographic coordinates using the Haversine formula |
| `isInsideCircle` | `(deviceLat: number, deviceLon: number, fenceLat: number, fenceLon: number, radiusMeters: number) => boolean` | Returns `true` if the device coordinate is within `radiusMeters` of the fence center |
| `isInsidePolygon` | `(deviceLat: number, deviceLon: number, polygon: Array<{ lat: number; lng: number }>) => boolean` | Returns `true` if the point lies inside the polygon using the ray-casting algorithm |

## Internal Functions

| Name | Lines | Description |
|------|-------|-------------|
| `toRadians` | 8-10 | Converts degrees to radians |

## Key Logic

`haversineDistance` implements the standard Haversine formula using Earth's mean radius of 6,371,000 meters. It computes the great-circle distance between two lat/lon pairs.

`isInsideCircle` is a thin wrapper that compares `haversineDistance` against a radius threshold (strict less-than, so points exactly on the boundary are considered outside).

`isInsidePolygon` uses the ray-casting (odd-even rule) algorithm. It iterates over polygon edges and counts how many times a horizontal ray from the test point crosses an edge. A point is inside if the crossing count is odd. Polygons with fewer than 3 vertices always return `false`.
