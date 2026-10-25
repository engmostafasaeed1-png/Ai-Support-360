import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { partnerApi } from '@/lib/partnerPortal';

/** Consultant dashboard: accept/decline a partner invitation, or leave the current partner. Hidden when nothing applies. */
export default function PartnerInviteCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['partner-my-links'], queryFn: async () => (await partnerApi.myLinks()).data ?? [], staleTime: 60_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, fn: () => Promise<{ error: { message: string } | null }>) => {
    setBusy(id); const r = await fn(); setBusy(null);
    if (r.error) toast.error(r.error.message === 'already_in_partner' ? t('partner.already_in', 'Leave your current partner first.') : t('partner.error', 'Could not save. Please try again.'));
    qc.invalidateQueries({ queryKey: ['partner-my-links'] });
  };
  const links = q.data ?? [];
  if (!links.length) return null;
  return (
    <div className="space-y-2">{links.map((l) => (
      <Card key={l.id} className="rounded-2xl border-primary/30"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm"><Building2 className="h-4 w-4 text-primary" />
          {l.status === 'invited' ? t('partner.invite_text', '{{name}} invites you to join its partner team. Your profile, interview and NDA stay your own.', { name: l.tenant_name })
            : t('partner.member_text', 'You are part of the partner team of {{name}}.', { name: l.tenant_name })}</p>
        <div className="flex gap-2">
          {l.status === 'invited' ? <>
            <Button size="sm" busy={busy === l.id} onClick={() => run(l.id, () => partnerApi.respond(l.id, true))}>{t('partner.accept', 'Accept')}</Button>
            <Button size="sm" variant="outline" busy={busy === l.id} onClick={() => run(l.id, () => partnerApi.respond(l.id, false))}>{t('partner.decline', 'Decline')}</Button>
          </> : <Button size="sm" variant="outline" busy={busy === l.id} onClick={() => run(l.id, () => partnerApi.leave())}>{t('partner.leave', 'Leave partner')}</Button>}
        </div>
      </CardContent></Card>))}
    </div>
  );
}
