import { describe, it, expect } from 'vitest';
import { haversineDistance, isInsideCircle, isInsidePolygon } from '../haversine.js';

describe('haversineDistance', () => {
  it('returns approximately 343km between London and Paris', () => {
    // London: 51.5074, -0.1278
    // Paris: 48.8566, 2.3522
    const distance = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522);
    // Known distance is approximately 343km (343,000m)
    expect(distance).toBeGreaterThan(340_000);
    expect(distance).toBeLessThan(346_000);
  });

  it('returns 0 for the same point', () => {
    const distance = haversineDistance(40.7128, -74.006, 40.7128, -74.006);
    expect(distance).toBe(0);
  });

  it('is symmetric (A to B equals B to A)', () => {
    const ab = haversineDistance(51.5074, -0.1278, 48.8566, 2.3522);
    const ba = haversineDistance(48.8566, 2.3522, 51.5074, -0.1278);
    expect(ab).toBeCloseTo(ba, 6);
  });

  it('returns approximately 10,000km for quarter-earth distance', () => {
    // Equator at 0,0 to North Pole at 90,0 should be ~10,018km
    const distance = haversineDistance(0, 0, 90, 0);
    expect(distance).toBeGreaterThan(10_000_000);
    expect(distance).toBeLessThan(10_100_000);
  });

  it('returns approximately 20,000km for antipodal points on equator', () => {
    // 0,0 to 0,180 should be ~20,037km (half the circumference)
    const distance = haversineDistance(0, 0, 0, 180);
    expect(distance).toBeGreaterThan(20_000_000);
    expect(distance).toBeLessThan(20_100_000);
  });

  it('handles negative coordinates correctly', () => {
    // Sydney: -33.8688, 151.2093
    // New York: 40.7128, -74.006
    const distance = haversineDistance(-33.8688, 151.2093, 40.7128, -74.006);
    // Known distance is approximately 15,989km
    expect(distance).toBeGreaterThan(15_900_000);
    expect(distance).toBeLessThan(16_100_000);
  });

  it('returns small distance for nearby points', () => {
    // Two points ~111m apart (0.001 degrees latitude at equator)
    const distance = haversineDistance(0, 0, 0.001, 0);
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });
});

describe('isInsideCircle', () => {
  // Use a fence centered at London (51.5074, -0.1278)
  const fenceLat = 51.5074;
  const fenceLon = -0.1278;

  it('returns true for a point inside the fence', () => {
    // A point about 500m from London center, with 1000m radius fence
    const result = isInsideCircle(51.508, -0.126, fenceLat, fenceLon, 1000);
    expect(result).toBe(true);
  });

  it('returns false for a point outside the fence', () => {
    // Paris is ~343km from London, use 100km radius
    const result = isInsideCircle(48.8566, 2.3522, fenceLat, fenceLon, 100_000);
    expect(result).toBe(false);
  });

  it('returns true for the same point as the fence center', () => {
    const result = isInsideCircle(fenceLat, fenceLon, fenceLat, fenceLon, 100);
    expect(result).toBe(true);
  });

  it('returns false for a point exactly on the boundary (strict less-than)', () => {
    // The implementation uses strict < so point at exact distance should return false
    const distance = haversineDistance(51.508, -0.126, fenceLat, fenceLon);
    const result = isInsideCircle(51.508, -0.126, fenceLat, fenceLon, distance);
    expect(result).toBe(false);
  });

  it('returns true for a very large radius', () => {
    // Half the earth circumference should contain any point
    const result = isInsideCircle(48.8566, 2.3522, fenceLat, fenceLon, 20_100_000);
    expect(result).toBe(true);
  });
});

describe('isInsidePolygon', () => {
  // Define a simple triangle around central London
  const triangle = [
    { lat: 51.52, lng: -0.15 }, // northwest
    { lat: 51.52, lng: -0.10 }, // northeast
    { lat: 51.49, lng: -0.125 }, // south
  ];

  it('returns true for a point inside the triangle', () => {
    // Center of the triangle
    const result = isInsidePolygon(51.51, -0.125, triangle);
    expect(result).toBe(true);
  });

  it('returns false for a point outside the triangle', () => {
    // A point well north of the triangle
    const result = isInsidePolygon(52.0, -0.125, triangle);
    expect(result).toBe(false);
  });

  it('returns false for a point to the east of the triangle', () => {
    const result = isInsidePolygon(51.51, 0.0, triangle);
    expect(result).toBe(false);
  });

  it('returns false for a point to the west of the triangle', () => {
    const result = isInsidePolygon(51.51, -0.3, triangle);
    expect(result).toBe(false);
  });

  it('returns false for a polygon with fewer than 3 vertices', () => {
    const line = [
      { lat: 51.52, lng: -0.15 },
      { lat: 51.52, lng: -0.10 },
    ];
    const result = isInsidePolygon(51.52, -0.125, line);
    expect(result).toBe(false);
  });

  it('returns false for an empty polygon', () => {
    const result = isInsidePolygon(51.52, -0.125, []);
    expect(result).toBe(false);
  });

  it('works with a square polygon', () => {
    const square = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 10, lng: 10 },
      { lat: 10, lng: 0 },
    ];
    // Point inside the square
    expect(isInsidePolygon(5, 5, square)).toBe(true);
    // Point outside the square
    expect(isInsidePolygon(15, 5, square)).toBe(false);
    expect(isInsidePolygon(-1, 5, square)).toBe(false);
  });

  it('works with a concave polygon (L-shape)', () => {
    // An L-shaped polygon
    const lShape = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 10 },
      { lat: 5, lng: 10 },
      { lat: 5, lng: 5 },
      { lat: 10, lng: 5 },
      { lat: 10, lng: 0 },
    ];
    // Inside the bottom part of the L
    expect(isInsidePolygon(2, 2, lShape)).toBe(true);
    // Inside the right part of the L
    expect(isInsidePolygon(7, 2, lShape)).toBe(true);
    // Outside - in the concave cutout
    expect(isInsidePolygon(7, 7, lShape)).toBe(false);
  });
});
