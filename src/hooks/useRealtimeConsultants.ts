import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { mockRecommendedConsultants } from '@/data/clientMockData';

export interface ConsultantLive {
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
  industries: string[];
}

/**
 * Hook that loads consultants from mock data and overlays real-time
 * availability_status changes from the consultants table via realtime.
 */
export function useRealtimeConsultants() {
  const [consultants, setConsultants] = useState<ConsultantLive[]>(mockRecommendedConsultants);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  useEffect(() => {
    // Subscribe to real-time changes on the consultants table
    const channel = supabase
      .channel('consultants-availability')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'consultants',
        },
        (payload) => {
          const updated = payload.new as any;
          setConsultants(prev =>
            prev.map(c => {
              // Match by consultant table id or by name fallback
              if (c.id === updated.id) {
                return {
                  ...c,
                  available: updated.availability_status === 'available',
                  rating: updated.rating ?? c.rating,
                  reviews: updated.total_reviews ?? c.reviews,
                  rate: updated.hourly_rate ?? c.rate,
                  // Update location if provided
                  ...(updated.location ? {
                    lat: updated.location.x,
                    lng: updated.location.y,
                  } : {}),
                };
              }
              return c;
            })
          );
        }
      )
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { consultants, realtimeConnected };
}
