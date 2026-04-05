import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Star, BadgeCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

const createConsultantIcon = (avatar: string, available: boolean) => {
  const statusColor = available ? '#22c55e' : '#9ca3af';
  const bgColor = available ? '#1B2559' : '#64748b';

  return L.divIcon({
    className: 'consultant-marker',
    html: `
      <div style="position:relative;width:48px;height:56px;">
        <div style="width:44px;height:44px;border-radius:14px;background:${bgColor};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.25);border:2px solid white;">
          ${avatar}
        </div>
        <div style="position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:${statusColor};border:2px solid white;"></div>
        <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:8px solid ${bgColor};margin:0 auto;"></div>
      </div>
    `,
    iconSize: [48, 56],
    iconAnchor: [24, 56],
    popupAnchor: [0, -56],
  });
};

const badgeConfig: Record<string, { icon: typeof Star; color: string }> = {
  verified: { icon: BadgeCheck, color: 'text-accent' },
  top_rated: { icon: Star, color: 'text-yellow-500' },
  fast_responder: { icon: Zap, color: 'text-green-500' },
};

function FitBounds({ consultants }: { consultants: Consultant[] }) {
  const map = useMap();
  useEffect(() => {
    if (consultants.length === 0) return;
    const bounds = L.latLngBounds(consultants.map(c => [c.lat, c.lng]));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 8 });
  }, [consultants, map]);
  return null;
}

interface ConsultantMapProps {
  consultants: Consultant[];
}

export default function ConsultantMap({ consultants }: ConsultantMapProps) {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl overflow-hidden border border-border/50 shadow-sm" style={{ height: '420px' }}>
      <MapContainer
        center={[24.7, 46.7]}
        zoom={5}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds consultants={consultants} />
        {consultants.map(c => (
          <Marker key={c.id} position={[c.lat, c.lng]} icon={createConsultantIcon(c.avatar, c.available)}>
            <Popup className="consultant-popup" maxWidth={280} minWidth={240}>
              <div className="p-1">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ background: c.available ? '#1B2559' : '#64748b' }}>
                    {c.avatar}
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-semibold text-sm truncate">{c.name}</h4>
                    <p className="text-xs text-gray-500 truncate">{c.specialty}</p>
                    <p className="text-[10px] text-gray-400">{c.city}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
                  <span className="text-sm font-semibold">{c.rating}</span>
                  <span className="text-xs text-gray-400">({c.reviews})</span>
                  <span className="ms-auto text-xs text-gray-400">{c.matchScore}% match</span>
                </div>
                <div className="flex flex-wrap gap-1 mb-3">
                  {c.badges.map(badge => {
                    const cfg = badgeConfig[badge];
                    if (!cfg) return null;
                    const BIcon = cfg.icon;
                    return (
                      <span key={badge} className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        <BIcon className={`w-2.5 h-2.5 ${cfg.color}`} />
                        {badge.replace('_', ' ')}
                      </span>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="text-base font-bold">${c.rate}</span>
                    <span className="text-[10px] text-gray-400">/hr</span>
                  </div>
                  {c.available ? (
                    <span className="text-[10px] text-green-600 font-medium flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      {t('consultants.available')}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-400 font-medium">
                      {t('consultants.offline') || 'Offline'}
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <button className="flex-1 text-[10px] font-medium px-3 py-1.5 rounded-lg bg-[#1B2559] text-white hover:bg-[#1B2559]/90 transition-colors">
                    {t('consultants.book_session') || 'Book Session'}
                  </button>
                  <button className="flex-1 text-[10px] font-medium px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                    {t('consultants.view_profile') || 'View Profile'}
                  </button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
