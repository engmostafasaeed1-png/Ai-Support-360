import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { safeRpc } from '@/lib/safeRpc';
import AdminMessageEmailLog from './AdminMessageEmailLog';

interface Settings { enabled: boolean; daily_cap: number; per_recipient_hour: number; per_admin_hour: number; sent_today: number; waiting: number; skipped_today: number; failed_today: number }
const KEY = ['admin-message-email-settings'];

/** Admin setting admin_messages_email_enabled (default on) + daily cap, today's counts and the recent delivery history. */
export default function AdminMessageEmailSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY, retry: false,
    queryFn: async (): Promise<Settings | null> => {
      const { data, error } = await safeRpc<Settings>('admin_message_email_settings');
      return error ? null : data;
    },
  });
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setCap(String(q.data.daily_cap)); }, [q.data]);
  const capNum = Number(cap);
  const capBad = !Number.isInteger(capNum) || capNum < 1 || capNum > 5000;

  async function save(enabled: boolean, dailyCap: number) {
    setBusy(true);
    const { error } = await safeRpc('admin_set_message_email_settings', { _enabled: enabled, _daily_cap: dailyCap });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t('common.saved', 'Saved'));
    qc.invalidateQueries({ queryKey: KEY });
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" aria-hidden />{t('ame.settings_title', 'Admin messages by e-mail')}</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">{t('ame.settings_hint', 'Every message or decision an administrator sends to one person is also e-mailed to them, once, in their language. Lists stay in-app; flows with their own e-mail are not mailed twice; at most 5 per person per hour (the rest arrive as one digest).')}</p>
        {q.data === null ? (
          <p className="text-xs text-muted-foreground">{t('ame.not_ready', 'Delivery status appears once the prepared database update is applied.')}</p>
        ) : q.data ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="ame-enabled">{t('ame.enabled', 'E-mail admin messages')}</Label>
              <Switch id="ame-enabled" checked={q.data.enabled} disabled={busy} /* disabled-ok: saving */ onCheckedChange={(v) => save(v, q.data!.daily_cap)} />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="ame-cap">{t('ame.daily_cap', 'Daily cap (e-mails per day)')}</Label>
                <Input id="ame-cap" type="number" min={1} max={5000} className="w-32" value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={capBad} />
              </div>
              <Button size="sm" variant="outline" busy={busy}
                reason={[capBad && 'invalid_value', !capBad && capNum === q.data.daily_cap && 'nothing_changed']}
                onClick={() => save(q.data!.enabled, capNum)}>{t('common.save', 'Save')}</Button>
            </div>
            <p className="text-xs text-muted-foreground" role="status">
              {t('ame.today', 'Today: {{sent}} sent, {{waiting}} waiting, {{skipped}} skipped, {{failed}} failed', { sent: q.data.sent_today, waiting: q.data.waiting, skipped: q.data.skipped_today, failed: q.data.failed_today })}
            </p>
            <section className="space-y-2" aria-labelledby="ame-hist">
              <h3 id="ame-hist" className="text-sm font-semibold">{t('ame.history', 'Recent admin messages')}</h3>
              <AdminMessageEmailLog limit={15} />
            </section>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
