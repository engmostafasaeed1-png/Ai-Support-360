import { useEffect, useMemo, useRef, useState } from 'react';
import L, { type LayerGroup, type Map as LeafletMap, type Marker } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';
import { OSM_ATTRIBUTION, OSM_TILES, spreadPins, type AvailabilityState } from '@/lib/mapMarkers';
import { buildMarkerElement, buildPopupElement, type PinView } from '@/lib/mapDom';
import { clusterPoints, CLUSTER_MAX_ZOOM } from '@/lib/mapCluster';
import type { Bounds } from '@/lib/directoryFilters';
import { usePublicResponsiveness } from '@/hooks/useResponsiveness';
import { useRatingMinReviews } from '@/hooks/useRingStats';
import { ringSummary, type RingSummary } from '@/lib/ringAvatar';

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
  linkedinVerified: boolean;
  credlyVerified: boolean;
  hours?: string[];
  approximate?: boolean;
  ai_interview_badge?: string | null;
  avatar_url?: string | null;
}

export type MapMatch = { score: number; chips: string[] };

interface ConsultantMapProps {
  consultants: MapConsultant[];
  selectedId?: string | null;
  onSelectConsultant?: (id: string) => void;
  onViewProfile?: (id: string) => void;
  /** Opens the page for a new request (sessions are arranged inside a request). */
  onOpenRequest?: () => void;
  /** Invite a consultant to a new request (replaces "Open a request" in the popup). */
  onInvite?: (id: string) => void;
  /** Feature O: favourite state and toggle for the popup heart (only when the client may edit favourites). */
  favourite?: { has: (id: string) => boolean; toggle: (id: string) => Promise<boolean>; addLabel: string; removeLabel: string };
  /** Match % and chips for the current filters. */
  matches?: Map<string, MapMatch> | null;
  /** Called after the person moves or zooms the map (not after the map fits itself to the pins). */
  onBoundsChange?: (bounds: Bounds) => void;
}

const toView = (c: MapConsultant, m?: MapMatch | null, ring?: RingSummary | null): PinView => ({
  id: c.id,
  name: c.name,
  avatar: c.avatar,
  specialty: c.specialty,
  place: c.place,
  rating: c.rating,
  reviews: c.reviews,
  rate: c.rate,
  status: c.status,
  linkedinState: c.linkedinVerified ? 'checked' : 'none',
  credlyState: c.credlyVerified ? 'checked' : 'none',
  hours: c.hours,
  approximate: c.approximate,
  tier: c.ai_interview_badge ?? null,
  avatarUrl: c.avatar_url ?? null,
  matchScore: m?.score ?? null,
  chips: m?.chips,
  ring: ring ?? null,
});

function clusterElement(count: number, label: string): HTMLElement {
  const el = document.createElement('div');
  Object.assign(el.style, { width: '44px', height: '44px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '13px', color: 'white', backgroundColor: '#3B82F6', border: '3px solid white', boxShadow: '0 0 0 4px rgba(59,130,246,0.25), 0 4px 12px rgba(0,0,0,0.25)', cursor: 'pointer' });
  el.textContent = String(count);
  el.dataset.part = 'cluster';
  el.setAttribute('aria-label', label);
  return el;
}

/** The consultants on a map: one pin for every consultant who chose a city, coloured by Online, Busy or Offline. The pins show the area of the city, never an address. */
export default function ConsultantMap({ consultants, selectedId, onSelectConsultant, onViewProfile, onOpenRequest, onInvite, matches, onBoundsChange, favourite }: ConsultantMapProps) {
  const { t, i18n } = useTranslation();
  const holder = useRef<HTMLDivElement>(null);
  // Feature W: the popup photo carries the same performance ring as the cards.
  const { publicOn, byId: respById } = usePublicResponsiveness();
  const minReviews = useRatingMinReviews();
  const ringLang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const ringFor = (c: MapConsultant) => ringSummary({ rating: c.rating, reviews: c.reviews, minReviews, publicOn, resp: respById.get(c.id) ?? null, badge: c.ai_interview_badge, lang: ringLang });
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const fitted = useRef('');
  const lastSelected = useRef<string | null>(null);

  // The newest functions of the page are kept here, so that a new function in the page does not rebuild the pins (that would close an open popup).
  const handlers = useRef({ onSelectConsultant, onViewProfile, onOpenRequest, onInvite, onBoundsChange, favourite });
  handlers.current = { onSelectConsultant, onViewProfile, onOpenRequest, onInvite, onBoundsChange, favourite };
  const [zoom, setZoom] = useState(CLUSTER_MAX_ZOOM);
  // True while the map moves by itself (fitting to the pins), so that move is not reported as the person's own.
  const selfMove = useRef(false);

  const labels = {
    reviews: t('consultants_page.reviews', 'reviews'),
    viewProfile: t('consultants_page.view_profile', 'View profile'),
    openRequest: 'Open a request',
    noPlace: t('profileRules.locationNotSet', 'Location not set'),
    approximate: t('profileRules.approximate', 'Approximate location (country)'),
    invite: t('consultants_page.invite', 'Invite'),
    match: t('consultants_page.match', 'match'),
    badge: t('consultants_page.badge', 'badge'),
    cluster: t('consultants_page.cluster', 'consultants here, press to zoom in'),
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
    const anyMap = map as any;
    if (typeof anyMap.on === 'function') {
      anyMap.on('zoomend', () => setZoom(anyMap.getZoom?.() ?? CLUSTER_MAX_ZOOM));
      anyMap.on('moveend', () => {
        if (selfMove.current) { selfMove.current = false; return; }
        const b = anyMap.getBounds?.();
        if (b) handlers.current.onBoundsChange?.([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
      });
      setZoom(anyMap.getZoom?.() ?? CLUSTER_MAX_ZOOM);
    }
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
    // Dense areas are drawn as one round cluster with a count; the chosen consultant is always shown alone.
    const groups = clusterPoints(pins.filter(p => p.id !== selectedId), zoom);
    const single = new Set(groups.filter(g => g.ids.length === 1).map(g => g.ids[0]));
    if (selectedId) single.add(selectedId);
    for (const g of groups) {
      if (g.ids.length < 2) continue;
      const cluster = L.marker([g.lat, g.lng], {
        icon: L.divIcon({ className: 'consultant-cluster', html: clusterElement(g.ids.length, `${g.ids.length} ${labels.cluster}`), iconSize: [44, 44], iconAnchor: [22, 22] }),
        title: `${g.ids.length} ${labels.cluster}`,
        keyboard: true,
      } as any);
      cluster.on('click', () => {
        const points = pins.filter(p => g.ids.includes(p.id)).map(p => [p.lat, p.lng] as [number, number]);
        selfMove.current = false;
        map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: CLUSTER_MAX_ZOOM });
      });
      cluster.addTo(layer);
    }
    for (const pin of pins) {
      if (!single.has(pin.id)) continue;
      const c = byId.get(pin.id);
      if (!c) continue;
      const view = toView(c, matches?.get(c.id), ringFor(c));
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
        buildPopupElement(view, {
          onView: id => handlers.current.onViewProfile?.(id),
          onOpenRequest: () => handlers.current.onOpenRequest?.(),
          onInvite: handlers.current.onInvite ? id => handlers.current.onInvite?.(id) : undefined,
          favourite: handlers.current.favourite ? {
            on: handlers.current.favourite.has(c.id),
            toggle: id => handlers.current.favourite?.toggle(id) ?? Promise.resolve(false),
            addLabel: handlers.current.favourite.addLabel,
            removeLabel: handlers.current.favourite.removeLabel,
          } : undefined,
        }, labels),
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
        selfMove.current = true;
        map.fitBounds(L.latLngBounds(pins.map(p => [p.lat, p.lng] as [number, number])), { padding: [50, 50], maxZoom: 8 });
      }
    }
    if (chosen) {
      if (lastSelected.current !== selectedId) map.panTo(chosen.getLatLng());
      chosen.openPopup();
    }
    lastSelected.current = selectedId ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultants, pins, selectedId, labelsKey, zoom, matches, favourite]);

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
