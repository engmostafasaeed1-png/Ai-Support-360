import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BellOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';

interface Overview { paused_now: number; paused_email: number; paused_in_app: number; marked_unavailable: number; enabled: boolean; max_days: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string) => (supabase as any).rpc(name);
const MAX_OPTIONS = [3, 7, 30] as const;
export const ADMIN_PAUSE_KEY = ['admin-notification-pause'];

export function useNotificationPauseOverview(enabled = true) {
  return useQuery({
    queryKey: ADMIN_PAUSE_KEY,
    enabled,
    retry: false,
    queryFn: async (): Promise<Overview> => {
      const { data, error } = await rpc('admin_notification_pause_overview');
      if (error) throw error;
      return data as Overview;
    },
  });
}

/** Feature Q admin settings: switch (notification_pause_enabled, default on), longest pause and a read-only count. */
export default function NotificationPauseAdminCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const overview = useNotificationPauseOverview();
  const save = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean | number }) => {
      const { error } = await supabase.from('platform_settings').upsert({ key, value: value as never }, { onConflict: 'key' });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(t('npause.admin_saved', 'Saved')); qc.invalidateQueries({ queryKey: ADMIN_PAUSE_KEY }); },
    onError: (e) => toast.error(t('npause.save_failed', 'Your pause could not be saved.'), { description: (e as Error).message }),
  });
  const o = overview.data;

  return (
    <Card id="notification-pause">
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <BellOff className="h-5 w-5 text-primary" aria-hidden />
        <CardTitle className="text-base">{t('npause.admin_title', 'Pause notifications')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {overview.isLoading ? <Skeleton className="h-16 w-full" /> : overview.isError ? (
          <p className="text-sm text-muted-foreground">{t('npause.admin_not_ready', 'Available after the prepared database update for pausing notifications is applied.')}</p>
        ) : o && (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="notification_pause_enabled">{t('npause.admin_switch', 'Let people pause notifications')}</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('npause.admin_switch_hint', 'Off: nobody can start a pause and current pauses stop holding notices. Essential notices are never paused.')}</p>
              </div>
              <Switch id="notification_pause_enabled" checked={o.enabled} disabled={save.isPending}
                onCheckedChange={(v) => save.mutate({ key: 'notification_pause_enabled', value: v })} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="notification_pause_max">{t('npause.admin_max', 'Longest pause')}</Label>
              <Select value={String(MAX_OPTIONS.find((n) => n >= o.max_days) ?? 30)} onValueChange={(v) => save.mutate({ key: 'notification_pause_max_days', value: Number(v) })}>
                <SelectTrigger id="notification_pause_max" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">{t('npause.d3', '3 days')}</SelectItem>
                  <SelectItem value="7">{t('npause.w1', '1 week')}</SelectItem>
                  <SelectItem value="30">{t('npause.m1', '1 month')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm" aria-live="polite">
              {t('npause.admin_count', '{{n}} people have paused notifications right now ({{e}} e-mails, {{a}} in-app; {{u}} consultants marked unavailable).', {
                n: o.paused_now, e: o.paused_email, a: o.paused_in_app, u: o.marked_unavailable,
              })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
