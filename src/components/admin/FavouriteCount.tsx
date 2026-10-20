import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Heart } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Administrators: how many clients / client organisations saved this consultant as a favourite.
 * A count only (never who); hidden until the Feature O database update is applied.
 */
export default function FavouriteCount({ consultantId }: { consultantId: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['admin-favourite-count', consultantId],
    retry: false,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await (supabase as any).rpc('admin_consultant_favourite_count', { _consultant_id: consultantId });
      return error || typeof data !== 'number' ? null : data;
    },
  });
  if (q.data == null) return null;
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="admin-favourite-count">
      <Heart className="h-4 w-4" aria-hidden="true" />
      {t('fav.admin_count', { count: q.data })}
    </p>
  );
}
