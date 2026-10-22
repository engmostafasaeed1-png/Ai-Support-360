import { formatRate, rateRangeText } from '@/lib/referrals';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Gift } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useInvalidateReferral, useMyReferralInvite } from '@/hooks/useReferralProgram';
import ReferralAckPanel from '@/components/referral/ReferralAckPanel';

const SEEN_KEY = 'aisupport360.referral-popup-shown';

interface Note { id: string; title: string; body: string; created_at: string }

/**
 * Pop-up at the next sign-in: unread referral notices (registered with your code, passed, active, reminders, expired)
 * and, for a referred consultant who has not accepted the referral terms yet, the acknowledgement itself.
 * Shown once per browser session; "Got it" marks the notices as read.
 */
export default function ReferralNoticePopup() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const qc = useQueryClient();
  const invalidate = useInvalidateReferral();
  const [open, setOpen] = useState(false);
  const [shown] = useState(() => { try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } });
  const invite = useMyReferralInvite(!isGuest && !shown);
  const notes = useQuery({
    queryKey: ['referral-popup-notes'],
    enabled: !isGuest && !shown,
    retry: false,
    staleTime: Infinity,
    queryFn: async (): Promise<Note[]> => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data, error } = await supabase.from('notifications').select('id, title, body, created_at')
        .eq('type', 'referral').eq('is_read', false).gte('created_at', since).order('created_at', { ascending: false }).limit(4);
      if (error) return [];
      return (data ?? []) as Note[];
    },
  });
  const needsAck = !!invite.data && invite.data.activation_status === 'pending' && !invite.data.i_acknowledged_at;
  const list = notes.data ?? [];

  useEffect(() => {
    if (shown || open || notes.isLoading || invite.isLoading) return;
    if (list.length > 0 || needsAck) {
      setOpen(true);
      try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    }
  }, [shown, open, notes.isLoading, invite.isLoading, list.length, needsAck]);

  const close = async () => {
    setOpen(false);
    if (list.length) {
      await supabase.from('notifications').update({ is_read: true }).in('id', list.map((n) => n.id));
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
  };

  if (!open) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) void close(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Gift className="w-5 h-5 text-primary" />{t('refz.popup_title', 'Your referral')}</DialogTitle>
          <DialogDescription className="sr-only">{t('refz.popup_desc', 'Referral programme updates')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {list.map((n) => (
            <div key={n.id} className="rounded-xl border border-border/60 p-3">
              <p className="text-sm font-medium">{n.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
            </div>
          ))}
          {needsAck && invite.data && (
            <div className="rounded-xl border border-primary/30 p-3 space-y-2">
              <p className="text-sm font-medium">
                {t('refz.signup_invited', 'You were invited by {{name}}. The referral programme becomes active after you and your referrer pass the AI interview.', { name: invite.data.referrer_name })}
              </p>
              <ReferralAckPanel version={invite.data.terms_version} rateText={invite.data.tiers?.length ? rateRangeText(invite.data.tiers) : formatRate(invite.data.rate_percent)} months={invite.data.months}
                passMark={invite.data.pass_mark} source="popup" onDone={() => { invalidate(); void close(); }} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void close()}>{t('refz.got_it', 'Got it')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
