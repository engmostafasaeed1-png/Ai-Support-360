// Pure helpers for the consultants map: the three availability states and the place of every pin.

export type AvailabilityState = 'available' | 'busy' | 'offline';

/** How a state is called and drawn. `color` is for the map, `dot` is the Tailwind class of the small round dot in the lists. */
export const STATE_META: Record<AvailabilityState, { label: string; color: string; dot: string; order: number }> = {
  available: { label: 'Online', color: '#22c55e', dot: 'bg-green-500', order: 0 },
  busy: { label: 'Busy', color: '#f59e0b', dot: 'bg-amber-500', order: 1 },
  offline: { label: 'Offline', color: '#9ca3af', dot: 'bg-muted-foreground/40', order: 2 },
};

/** The state in the database ("available", "busy" or "offline"); anything else counts as offline. */
export function availabilityState(value: string | null | undefined): AvailabilityState {
  return value === 'available' || value === 'busy' ? value : 'offline';
}

export const OSM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export interface PinSource {
  id: string;
  lat: number | null;
  lng: number | null;
}

export interface Pin {
  id: string;
  lat: number;
  lng: number;
}

type Placed = PinSource & { lat: number; lng: number };

function hasPoint(p: PinSource): p is Placed {
  return typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

const GOLDEN_ANGLE = 2.399963229728653;
/** Distance between the first rings of a spiral, in degrees of latitude (about 1.3 km). */
const STEP = 0.012;
const round5 = (n: number) => Math.round(n * 100000) / 100000;

/**
 * One pin for every consultant that has a point; the others are left out.
 * Consultants of the same city share the same point (the centre of the city, rounded to about 1 km), so they would lie on top of each other:
 * they are laid out around that centre in a spiral, a few km wide at most. The result only depends on the ids, so a pin does not jump when the list is loaded again.
 * The order of the input is kept.
 */
export function spreadPins(items: PinSource[]): Pin[] {
  const groups = new Map<string, Placed[]>();
  for (const item of items) {
    if (!hasPoint(item)) continue;
    const key = `${item.lat.toFixed(2)},${item.lng.toFixed(2)}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const placed = new Map<string, Pin>();
  for (const group of groups.values()) {
    group.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const { lat, lng } = group[0];
    if (group.length === 1) {
      placed.set(group[0].id, { id: group[0].id, lat, lng });
      continue;
    }
    const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
    group.forEach((item, i) => {
      const radius = STEP * Math.sqrt(i + 0.5);
      const angle = i * GOLDEN_ANGLE;
      placed.set(item.id, { id: item.id, lat: round5(lat + radius * Math.sin(angle)), lng: round5(lng + (radius * Math.cos(angle)) / cos) });
    });
  }
  const pins: Pin[] = [];
  for (const item of items) {
    const pin = placed.get(item.id);
    if (pin) pins.push(pin);
  }
  return pins;
}

/** How many consultants have no point and therefore cannot be shown on the map. */
export function countWithoutPlace(items: PinSource[]): number {
  return items.filter(item => !hasPoint(item)).length;
}
