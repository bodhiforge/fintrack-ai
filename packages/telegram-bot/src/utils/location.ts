/**
 * Location Detection Utilities
 */

interface CityCoordinates {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radius: number;
}

const CITY_COORDINATES: readonly CityCoordinates[] = [
  // Canada
  { name: 'Toronto', latitude: 43.65, longitude: -79.38, radius: 0.5 },
  { name: 'Vancouver', latitude: 49.28, longitude: -123.12, radius: 0.5 },
  { name: 'Montreal', latitude: 45.50, longitude: -73.57, radius: 0.5 },
  { name: 'Calgary', latitude: 51.05, longitude: -114.07, radius: 0.5 },
  // USA
  { name: 'New York', latitude: 40.71, longitude: -74.01, radius: 0.5 },
  { name: 'Los Angeles', latitude: 34.05, longitude: -118.24, radius: 0.5 },
  { name: 'San Francisco', latitude: 37.77, longitude: -122.42, radius: 0.3 },
  { name: 'Seattle', latitude: 47.61, longitude: -122.33, radius: 0.3 },
  { name: 'Las Vegas', latitude: 36.17, longitude: -115.14, radius: 0.3 },
  { name: 'Hawaii', latitude: 21.31, longitude: -157.86, radius: 1.0 },
  // Mexico
  { name: 'Mexico City', latitude: 19.43, longitude: -99.13, radius: 0.5 },
  { name: 'Cancun', latitude: 21.16, longitude: -86.85, radius: 0.3 },
  // Central America
  { name: 'Costa Rica', latitude: 9.93, longitude: -84.08, radius: 1.0 },
  // Japan
  { name: 'Tokyo', latitude: 35.68, longitude: 139.69, radius: 0.5 },
  { name: 'Osaka', latitude: 34.69, longitude: 135.50, radius: 0.3 },
  { name: 'Kyoto', latitude: 35.01, longitude: 135.77, radius: 0.2 },
  // Europe
  { name: 'London', latitude: 51.51, longitude: -0.13, radius: 0.3 },
  { name: 'Paris', latitude: 48.86, longitude: 2.35, radius: 0.3 },
  { name: 'Rome', latitude: 41.90, longitude: 12.50, radius: 0.3 },
  { name: 'Barcelona', latitude: 41.39, longitude: 2.17, radius: 0.3 },
  { name: 'Amsterdam', latitude: 52.37, longitude: 4.90, radius: 0.2 },
  // Asia
  { name: 'Hong Kong', latitude: 22.32, longitude: 114.17, radius: 0.3 },
  { name: 'Singapore', latitude: 1.35, longitude: 103.82, radius: 0.3 },
  { name: 'Seoul', latitude: 37.57, longitude: 126.98, radius: 0.3 },
  { name: 'Bangkok', latitude: 13.76, longitude: 100.50, radius: 0.3 },
] as const;

export function detectCityFromCoords(
  latitude: number,
  longitude: number
): string | null {
  const matchedCity = CITY_COORDINATES.find(city => {
    const distance = Math.sqrt(
      Math.pow(latitude - city.latitude, 2) +
      Math.pow(longitude - city.longitude, 2)
    );
    return distance <= city.radius;
  });

  return matchedCity?.name ?? null;
}
