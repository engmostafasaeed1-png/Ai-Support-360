// Countries and cities a consultant can choose, each city with the point of its centre (rounded to 2 decimals, about 1 km).
// The map shows the area of a city, never an address, so a city centre is all that is stored (the database rounds every consultant's point to the same 2 decimals).

export interface Place {
  name: string;
  lat: number;
  lng: number;
}

interface CountryPlaces {
  country: string;
  cities: readonly Place[];
}

const c = (name: string, lat: number, lng: number): Place => ({ name, lat, lng });

export const PLACES: readonly CountryPlaces[] = [
  { country: 'Saudi Arabia', cities: [c('Riyadh', 24.71, 46.68), c('Jeddah', 21.54, 39.17), c('Dammam', 26.43, 50.1), c('Khobar', 26.28, 50.21), c('Mecca', 21.39, 39.86), c('Medina', 24.47, 39.61), c('Tabuk', 28.38, 36.57), c('Abha', 18.22, 42.51)] },
  { country: 'UAE', cities: [c('Dubai', 25.2, 55.27), c('Abu Dhabi', 24.45, 54.38), c('Sharjah', 25.35, 55.42), c('Ajman', 25.41, 55.44), c('Ras Al Khaimah', 25.79, 55.94), c('Fujairah', 25.12, 56.33)] },
  { country: 'Qatar', cities: [c('Doha', 25.29, 51.53), c('Al Wakrah', 25.17, 51.6), c('Al Khor', 25.68, 51.5), c('Lusail', 25.42, 51.5)] },
  { country: 'Kuwait', cities: [c('Kuwait City', 29.38, 47.99), c('Hawalli', 29.33, 48.03), c('Salmiya', 29.33, 48.07)] },
  { country: 'Bahrain', cities: [c('Manama', 26.23, 50.59), c('Riffa', 26.13, 50.56), c('Muharraq', 26.26, 50.61)] },
  { country: 'Oman', cities: [c('Muscat', 23.59, 58.41), c('Salalah', 17.02, 54.09), c('Sohar', 24.35, 56.71)] },
  { country: 'Egypt', cities: [c('Cairo', 30.04, 31.24), c('Alexandria', 31.2, 29.92), c('Giza', 30.01, 31.21), c('Sharm El Sheikh', 27.91, 34.33)] },
  { country: 'Jordan', cities: [c('Amman', 31.95, 35.93), c('Aqaba', 29.53, 35.01), c('Irbid', 32.56, 35.85)] },
  { country: 'Lebanon', cities: [c('Beirut', 33.89, 35.5), c('Tripoli', 34.44, 35.83), c('Sidon', 33.56, 35.37)] },
  { country: 'Iraq', cities: [c('Baghdad', 33.31, 44.36), c('Erbil', 36.19, 44.01), c('Basra', 30.51, 47.78)] },
  { country: 'Morocco', cities: [c('Casablanca', 33.57, -7.59), c('Rabat', 34.02, -6.84), c('Marrakesh', 31.63, -8.01)] },
  { country: 'Tunisia', cities: [c('Tunis', 36.81, 10.18), c('Sfax', 34.74, 10.76)] },
  { country: 'United States', cities: [c('New York', 40.71, -74.01), c('San Francisco', 37.77, -122.42), c('Chicago', 41.88, -87.63), c('Dallas', 32.78, -96.8), c('Houston', 29.76, -95.37), c('Atlanta', 33.75, -84.39), c('Los Angeles', 34.05, -118.24), c('Seattle', 47.61, -122.33), c('Boston', 42.36, -71.06)] },
  { country: 'United Kingdom', cities: [c('London', 51.51, -0.13), c('Manchester', 53.48, -2.24), c('Birmingham', 52.49, -1.89), c('Edinburgh', 55.95, -3.19), c('Leeds', 53.8, -1.55)] },
  { country: 'Germany', cities: [c('Berlin', 52.52, 13.4), c('Munich', 48.14, 11.58), c('Frankfurt', 50.11, 8.68), c('Hamburg', 53.55, 9.99), c('Cologne', 50.94, 6.96), c('Walldorf', 49.3, 8.64)] },
  { country: 'France', cities: [c('Paris', 48.86, 2.35), c('Lyon', 45.76, 4.84), c('Marseille', 43.3, 5.37), c('Toulouse', 43.6, 1.44)] },
  { country: 'Netherlands', cities: [c('Amsterdam', 52.37, 4.9), c('Rotterdam', 51.92, 4.48), c('The Hague', 52.08, 4.3), c('Utrecht', 52.09, 5.12)] },
  { country: 'India', cities: [c('Mumbai', 19.08, 72.88), c('Bangalore', 12.97, 77.59), c('Hyderabad', 17.39, 78.49), c('Delhi', 28.61, 77.21), c('Chennai', 13.08, 80.27), c('Pune', 18.52, 73.86), c('Kolkata', 22.57, 88.36), c('Noida', 28.54, 77.39), c('Gurgaon', 28.46, 77.03)] },
  { country: 'Pakistan', cities: [c('Karachi', 24.86, 67.0), c('Lahore', 31.55, 74.34), c('Islamabad', 33.68, 73.05), c('Rawalpindi', 33.57, 73.14)] },
  { country: 'Philippines', cities: [c('Manila', 14.6, 120.98), c('Cebu', 10.32, 123.89), c('Davao', 7.19, 125.46)] },
  { country: 'Malaysia', cities: [c('Kuala Lumpur', 3.14, 101.69), c('Penang', 5.41, 100.33), c('Johor Bahru', 1.49, 103.74)] },
  { country: 'Singapore', cities: [c('Singapore', 1.35, 103.82)] },
  { country: 'Turkey', cities: [c('Istanbul', 41.01, 28.98), c('Ankara', 39.93, 32.86), c('Izmir', 38.42, 27.14)] },
  { country: 'South Africa', cities: [c('Johannesburg', -26.2, 28.05), c('Cape Town', -33.92, 18.42), c('Durban', -29.86, 31.02)] },
  { country: 'Nigeria', cities: [c('Lagos', 6.52, 3.38), c('Abuja', 9.08, 7.4), c('Port Harcourt', 4.82, 7.05)] },
  { country: 'Brazil', cities: [c('São Paulo', -23.55, -46.63), c('Rio de Janeiro', -22.91, -43.17), c('Brasília', -15.79, -47.88)] },
  { country: 'Canada', cities: [c('Toronto', 43.65, -79.38), c('Vancouver', 49.28, -123.12), c('Montreal', 45.5, -73.57), c('Calgary', 51.05, -114.07)] },
  { country: 'Australia', cities: [c('Sydney', -33.87, 151.21), c('Melbourne', -37.81, 144.96), c('Brisbane', -27.47, 153.03), c('Perth', -31.95, 115.86)] },
  { country: 'Japan', cities: [c('Tokyo', 35.68, 139.69), c('Osaka', 34.69, 135.5), c('Nagoya', 35.18, 136.91)] },
  { country: 'South Korea', cities: [c('Seoul', 37.57, 126.98), c('Busan', 35.18, 129.08)] },
  { country: 'China', cities: [c('Shanghai', 31.23, 121.47), c('Beijing', 39.9, 116.41), c('Shenzhen', 22.54, 114.06), c('Guangzhou', 23.13, 113.26)] },
  { country: 'Indonesia', cities: [c('Jakarta', -6.21, 106.85), c('Surabaya', -7.25, 112.75), c('Bandung', -6.92, 107.61)] },
  { country: 'Thailand', cities: [c('Bangkok', 13.76, 100.5), c('Chiang Mai', 18.79, 98.98)] },
  { country: 'Vietnam', cities: [c('Ho Chi Minh City', 10.82, 106.63), c('Hanoi', 21.03, 105.85)] },
  { country: 'Italy', cities: [c('Milan', 45.46, 9.19), c('Rome', 41.9, 12.5), c('Turin', 45.07, 7.69)] },
  { country: 'Spain', cities: [c('Madrid', 40.42, -3.7), c('Barcelona', 41.39, 2.17), c('Valencia', 39.47, -0.38)] },
  { country: 'Poland', cities: [c('Warsaw', 52.23, 21.01), c('Krakow', 50.06, 19.94), c('Wroclaw', 51.11, 17.04)] },
  { country: 'Switzerland', cities: [c('Zurich', 47.38, 8.54), c('Geneva', 46.2, 6.14), c('Basel', 47.56, 7.59)] },
  { country: 'Sweden', cities: [c('Stockholm', 59.33, 18.07), c('Gothenburg', 57.71, 11.97), c('Malmö', 55.6, 13.0)] },
  { country: 'Ireland', cities: [c('Dublin', 53.35, -6.26), c('Cork', 51.9, -8.47)] },
];

export const COUNTRIES: readonly string[] = PLACES.map(p => p.country);

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The names of the cities of a country, in the order of the list. */
export function citiesOf(country: string): string[] {
  const found = PLACES.find(p => same(p.country, country));
  return found ? found.cities.map(x => x.name) : [];
}

/** The centre point of a city, or null when the country or the city is not in the list. */
export function cityPoint(country: string, city: string): { lat: number; lng: number } | null {
  const found = PLACES.find(p => same(p.country, country))?.cities.find(x => same(x.name, city));
  return found ? { lat: found.lat, lng: found.lng } : null;
}

/** "Cairo, Egypt", or only the country, or an empty text. */
export function placeLabel(city?: string | null, country?: string | null): string {
  return [city, country].map(x => (x ?? '').trim()).filter(Boolean).join(', ');
}
