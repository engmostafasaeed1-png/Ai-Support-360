import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BadgeCheck, Loader2, Lock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { isMissingRpc, safeRpc } from '@/lib/safeRpc';
import { SENDER_DEFAULTS, senderProblems, VERIFIED_FROM_DOMAIN, type SenderProblem } from '../../../../supabase/functions/_shared/emailSender';

interface SenderRow { display_name: string; from: string; reply_to: string; contact: string; non_users_enabled: boolean; can_edit: boolean }
const DEFAULT_ROW: SenderRow = {
  display_name: SENDER_DEFAULTS.displayName, from: `${SENDER_DEFAULTS.fromLocal}@${VERIFIED_FROM_DOMAIN}`, reply_to: SENDER_DEFAULTS.replyTo,
  contact: SENDER_DEFAULTS.contactEmail, non_users_enabled: false, can_edit: false,
};
const PROBLEM_EN: Record<SenderProblem, string> = {
  display_name: 'Display name: 1 to 60 letters, digits, spaces or & . - \' ( ) - no quotes or commas.',
  from_format: 'From must be a valid address (for example noreply@aisupport360.com).',
  from_domain_not_verified: 'From must use the verified sending domain aisupport360.com.',
  reply_to: 'Reply-To must be an address on aisupport360.com.',
  contact: 'The contact line must be an address on aisupport360.com.',
};

/**
 * Sender identity of the platform e-mails (Refer & earn e-mails and their test send): display name, From (verified
 * domain only), Reply-To and the footer contact line. Super admins edit; the server validates again and audits.
 * "E-mails to people who are not registered" stays locked off (needs owner approval + a marketing e-mail service).
 */
export default function EmailSenderCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['email-sender'],
    retry: false,
    queryFn: async () => {
      const { data, error } = await safeRpc<SenderRow>('admin_email_sender_settings');
      if (error) return { installed: !isMissingRpc(error), row: DEFAULT_ROW };
      return { installed: true, row: { ...DEFAULT_ROW, ...(data ?? {}) } };
    },
  });
  const row = q.data?.row ?? DEFAULT_ROW;
  const installed = q.data?.installed ?? true;
  const [form, setForm] = useState(row);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(row); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const problems = senderProblems({ displayName: form.display_name, from: form.from, replyTo: form.reply_to, contactEmail: form.contact });
  const canEdit = installed && row.can_edit;

  const save = async () => {
    setBusy(true);
    const { error } = await safeRpc('admin_set_email_sender_settings', {
      _payload: { display_name: form.display_name.trim(), from: form.from.trim(), reply_to: form.reply_to.trim(), contact: form.contact.trim() },
    });
    setBusy(false);
    if (error) { toast.error(error.message || t('esend.failed', 'The settings could not be saved.')); return; }
    toast.success(t('esend.saved', 'Sender settings saved.'));
    qc.invalidateQueries({ queryKey: ['email-sender'] });
  };
  const field = (id: keyof SenderRow, label: string, hint: string) => (
    <div className="space-y-1">
      <Label htmlFor={`esend-${id}`}>{label}</Label>
      <Input id={`esend-${id}`} dir="ltr" value={String(form[id] ?? '')} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, [id]: e.target.value }))} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {t('esend.title', 'E-mail sender')}
          <Badge variant="secondary" className="gap-1"><BadgeCheck className="h-3.5 w-3.5" aria-hidden />{t('esend.verified', 'Verified domain: aisupport360.com (sent via notify.aisupport360.com)')}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!installed && <p className="rounded-xl border border-info/30 bg-info/10 p-3" role="status">{t('esend.not_installed', 'Waits for the prepared database update (e-mail sender). Until then the e-mails use these defaults.')}</p>}
        {installed && !row.can_edit && <p className="text-xs text-muted-foreground">{t('esend.read_only', 'Only a super admin can change these settings.')}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {field('display_name', t('esend.name', 'Display name'), t('esend.name_hint', 'Shown as the sender name in the inbox.'))}
          {field('from', t('esend.from', 'From address'), t('esend.from_hint', 'Must be on aisupport360.com (verified for sending).'))}
          {field('reply_to', t('esend.reply', 'Reply-To'), t('esend.reply_hint', 'Replies go here (for example info@aisupport360.com).'))}
          {field('contact', t('esend.contact', 'Contact line in the footer'), t('esend.contact_hint', 'Shown as "Questions? Write to …" in every Refer & earn e-mail.'))}
        </div>
        {problems.length > 0 && (
          <ul className="space-y-0.5 text-xs text-destructive" role="alert">{problems.map((p) => <li key={p}>{t(`esend.p_${p}`, PROBLEM_EN[p])}</li>)}</ul>
        )}
        <Button onClick={() => void save()} disabled={!canEdit || busy || problems.length > 0}>{busy && <Loader2 className="me-1 h-4 w-4 animate-spin" />}{t('esend.save', 'Save sender settings')}</Button>

        <div className="flex items-start gap-3 rounded-xl border border-dashed p-3">
          <Switch id="esend-nonusers" checked={false} disabled aria-describedby="esend-nonusers-hint" />
          <div>
            <Label htmlFor="esend-nonusers" className="flex items-center gap-1 font-medium"><Lock className="h-3.5 w-3.5" aria-hidden />{t('esend.nonusers', 'Platform e-mails to colleagues who are not registered')}</Label>
            <p id="esend-nonusers-hint" className="text-xs text-muted-foreground">{t('esend.nonusers_hint', 'Locked off. Consultants invite colleagues from their own mailbox or apps (Share panel). Switching this on needs the owner\'s explicit approval and a dedicated marketing e-mail service with consent records and unsubscribe.')}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
