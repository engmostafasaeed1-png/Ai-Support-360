import { useSessionReady } from '@/hooks/useSessionReady';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import WeeklyAvailability from '@/components/client/WeeklyAvailability';

export default function ProfileAvailability({ consultantId }: { consultantId: string }) {
  const signedIn = useSessionReady().signedIn;
  const { data } = useQuery({
    enabled: signedIn,
    queryKey: ['my-availability-slots'],
    queryFn: async () => {
      const { data: slots, error } = await supabase.from('availability_slots')
        .select('id, day_of_week, start_time, end_time').eq('consultant_id', consultantId).order('day_of_week').order('start_time');
      if (error) throw error;
      return { consultantId, slots: slots || [] };
    },
  });
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return <WeeklyAvailability hours={data?.slots.flatMap(s => s.day_of_week === null ? [] : [`${days[s.day_of_week]} ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`])} />;
}