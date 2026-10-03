import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OSM_ATTRIBUTION, OSM_TILES } from '@/lib/mapMarkers';

interface Props {
  lat: number;
  lng: number;
  /** "Cairo, Egypt" */
  place: string;
}

/** The area where a consultant works from: a circle around the centre of the city. It never shows an address. */
export default function ConsultantLocationMap({ lat, lng, place }: Props) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const map = L.map(element, { scrollWheelZoom: false }).setView([lat, lng], 9);
    L.tileLayer(OSM_TILES, { attribution: OSM_ATTRIBUTION, maxZoom: 18 }).addTo(map);
    L.circle([lat, lng], { radius: 5000, color: '#3B82F6', weight: 2, fillColor: '#3B82F6', fillOpacity: 0.15 }).addTo(map);
    const resize = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(resize);
      map.remove();
    };
  }, [lat, lng]);

  return (
    <Card className="rounded-2xl border-border/50" data-testid="consultant-location-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <MapPin className="w-4 h-4 text-accent" aria-hidden="true" /> Where they work from
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-foreground">{place}</p>
        <div className="relative isolate overflow-hidden rounded-xl border border-border/50">
          <div ref={holder} role="img" aria-label={`Map of the area of ${place}`} style={{ height: '220px', width: '100%' }} />
        </div>
        <p className="text-[11px] text-muted-foreground">The circle shows the area of the city. The exact address of a consultant is never shown.</p>
      </CardContent>
    </Card>
  );
}
