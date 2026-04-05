import { useEffect, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTranslation } from 'react-i18next';

interface Consultant {
  id: string;
  name: string;
  specialty: string;
  rating: number;
  reviews: number;
  rate: number;
  avatar: string;
  available: boolean;
  matchScore: number;
  badges: string[];
  lat: number;
  lng: number;
  city: string;
}

interface ConsultantMapProps {
  consultants: Consultant[];
  selectedId?: string | null;
  onSelectConsultant?: (id: string) => void;
}

export default function ConsultantMap({ consultants, selectedId, onSelectConsultant }: ConsultantMapProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const container = document.getElementById('consultant-map');
    if (!container || (container as any)._leaflet_id) return;

    const map = L.map(container, { zoomControl: false }).setView([24.7, 46.7], 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    if (consultants.length > 0) {
      const bounds = L.latLngBounds(consultants.map(c => [c.lat, c.lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 8 });
    }

    consultants.forEach(c => {
      const isSelected = c.id === selectedId;
      const statusColor = c.available ? '#22c55e' : '#9ca3af';
      const bgColor = c.available ? '#1B2559' : '#64748b';
      const ring = isSelected ? 'border:3px solid #3B82F6;box-shadow:0 0 0 4px rgba(59,130,246,0.3),' : 'border:2px solid white;box-shadow:';

      const icon = L.divIcon({
        className: 'consultant-marker',
        html: `
          <div style="position:relative;width:48px;height:56px;cursor:pointer;">
            <div style="width:44px;height:44px;border-radius:14px;background:${bgColor};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;${ring}0 4px 12px rgba(0,0,0,0.25);transition:transform 0.15s;${isSelected ? 'transform:scale(1.15);' : ''}">
              ${c.avatar}
            </div>
            <div style="position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:${statusColor};border:2px solid white;"></div>
            <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:8px solid ${bgColor};margin:0 auto;"></div>
          </div>
        `,
        iconSize: [48, 56],
        iconAnchor: [24, 56],
        popupAnchor: [0, -56],
      });

      const availText = c.available
        ? `<span style="color:#16a34a;font-size:10px;font-weight:500;display:flex;align-items:center;gap:4px"><span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block"></span>${t('consultants.available')}</span>`
        : `<span style="color:#9ca3af;font-size:10px">${t('consultants.offline')}</span>`;

      const popup = L.popup({ maxWidth: 280, minWidth: 240 }).setContent(`
        <div style="padding:4px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
            <div style="width:44px;height:44px;border-radius:12px;background:${bgColor};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;flex-shrink:0">${c.avatar}</div>
            <div style="min-width:0">
              <div style="font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}</div>
              <div style="font-size:12px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.specialty}</div>
              <div style="font-size:10px;color:#9ca3af">${c.city}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            <span style="color:#eab308">★</span>
            <span style="font-weight:600;font-size:14px">${c.rating}</span>
            <span style="font-size:12px;color:#9ca3af">(${c.reviews} ${t('consultants_page.reviews')})</span>
            <span style="margin-inline-start:auto;font-size:12px;color:#9ca3af">${c.matchScore}% ${t('consultants_page.match')}</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div><span style="font-size:16px;font-weight:700">$${c.rate}</span><span style="font-size:10px;color:#9ca3af">/hr</span></div>
            ${availText}
          </div>
          <div style="display:flex;gap:6px">
            <button style="flex:1;font-size:10px;font-weight:500;padding:6px 12px;border-radius:8px;background:#1B2559;color:white;border:none;cursor:pointer">${t('consultants.book_session')}</button>
            <button style="flex:1;font-size:10px;font-weight:500;padding:6px 12px;border-radius:8px;background:white;border:1px solid #e5e7eb;cursor:pointer">${t('consultants.view_profile')}</button>
          </div>
        </div>
      `);

      const marker = L.marker([c.lat, c.lng], { icon }).addTo(map).bindPopup(popup);
      marker.on('click', () => {
        onSelectConsultant?.(c.id);
      });
    });

    return () => {
      map.remove();
    };
  }, [consultants, selectedId, t, onSelectConsultant]);

  return (
    <div className="rounded-2xl overflow-hidden border border-border/50 shadow-sm" style={{ height: '420px' }}>
      <div id="consultant-map" style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
