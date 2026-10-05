import { useEffect, useMemo, useRef } from 'react';
import L, { type LayerGroup, type Map as LeafletMap, type Marker } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import { OSM_ATTRIBUTION, OSM_TILES, spreadPins, type AvailabilityState } from '@/lib/mapMarkers';
import { buildMarkerElement, buildPopupElement, type PinView } from '@/lib/mapDom';
import type { LinkState } from '@/lib/consultantLinks';

export interface MapConsultant {
  id: string;
  name: string;
  avatar: string;
  specialty: string;
  rating: number;
  reviews: number;
  rate: number;
  /** The centre of the consultant's city; null when the consultant has not chosen a city (no pin). */
  lat: number | null;
  lng: number | null;
  place: string;
  status: AvailabilityState;
  linkedin_state: LinkState;
  credly_state: LinkState;
  hours?: string[];
}

interface ConsultantMapProps {
  consultants: MapConsultant[];
  selectedId?: string | null;
  onSelectConsultant?: (id: string) => void;
  onViewProfile?: (id: string) => void;
  onBook?: (id: string) => void;
}

const toView = (c: MapConsultant): PinView => ({
  id: c.id,
  name: c.name,
  avatar: c.avatar,
  specialty: c.specialty,
  place: c.place,
  rating: c.rating,
  reviews: c.reviews,
  rate: c.rate,
  status: c.status,
  linkedinState: c.linkedin_state,
  credlyState: c.credly_state,
  hours: c.hours,
});

/** The consultants on a map: one pin for every consultant who chose a city, coloured by Online, Busy or Offline. The pins show the area of the city, never an address. */
export default function ConsultantMap({ consultants, selectedId, onSelectConsultant, onViewProfile, onBook }: ConsultantMapProps) {
  const { t } = useTranslation();
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const fitted = useRef('');
  const lastSelected = useRef<string | null>(null);

  // The newest functions of the page are kept here, so that a new function in the page does not rebuild the pins (that would close an open popup).
  const handlers = useRef({ onSelectConsultant, onViewProfile, onBook });
  handlers.current = { onSelectConsultant, onViewProfile, onBook };

  const labels = {
    reviews: t('consultants_page.reviews', 'reviews'),
    viewProfile: t('consultants_page.view_profile', 'View profile'),
    bookSession: t('consultants_page.book_session', 'Book session'),
    noPlace: 'Location not set',
  };
  const labelsKey = JSON.stringify(labels);

  const pins = useMemo(() => spreadPins(consultants), [consultants]);

  // The map is made once.
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const map = L.map(element).setView([25, 40], 3);
    L.tileLayer(OSM_TILES, { attribution: OSM_ATTRIBUTION, maxZoom: 18 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const resize = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(resize);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fitted.current = '';
    };
  }, []);

  // The pins are drawn again when the consultants, the chosen consultant or the words change. The map is moved only when the set of consultants changes, so that a refresh does not take the map away from the person who is looking at it.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const byId = new Map(consultants.map(c => [c.id, c]));
    let chosen: Marker | null = null;
    for (const pin of pins) {
      const c = byId.get(pin.id);
      if (!c) continue;
      const view = toView(c);
      const isChosen = pin.id === selectedId;
      const marker = L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({
          className: 'consultant-marker',
          html: buildMarkerElement(view, isChosen),
          iconSize: [48, 56],
          iconAnchor: [24, 56],
          popupAnchor: [0, -56],
        }),
        title: c.name,
      }).bindPopup(
        buildPopupElement(view, { onView: id => handlers.current.onViewProfile?.(id), onBook: id => handlers.current.onBook?.(id) }, labels),
        { maxWidth: 280, minWidth: 240 },
      );
      marker.on('click', () => handlers.current.onSelectConsultant?.(c.id));
      marker.addTo(layer);
      if (isChosen) chosen = marker;
    }

    const key = pins.map(p => p.id).sort().join(',');
    if (key !== fitted.current) {
      fitted.current = key;
      if (pins.length > 0) {
        map.fitBounds(L.latLngBounds(pins.map(p => [p.lat, p.lng] as [number, number])), { padding: [50, 50], maxZoom: 8 });
      }
    }
    if (chosen) {
      if (lastSelected.current !== selectedId) map.panTo(chosen.getLatLng());
      chosen.openPopup();
    }
    lastSelected.current = selectedId ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultants, pins, selectedId, labelsKey]);

  return (
    <div className="relative isolate rounded-2xl overflow-hidden border border-border/50 shadow-sm" style={{ height: '420px' }}>
      <div ref={holder} data-testid="consultant-map" style={{ height: '100%', width: '100%' }} />
      {pins.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center p-4" data-testid="consultant-map-empty">
          <p className="rounded-xl bg-background/90 px-4 py-2 text-center text-sm text-muted-foreground shadow">
            No consultant here has chosen a city yet, so there is nothing to show on the map.
          </p>
        </div>
      )}
    </div>
  );
}
