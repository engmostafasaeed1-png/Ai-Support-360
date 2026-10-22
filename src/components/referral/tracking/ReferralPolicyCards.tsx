import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, FileText, RefreshCw } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ReferralAckPanel from '@/components/referral/ReferralAckPanel';
import type { TrackingInfo } from '@/hooks/useReferralTracking';
import { rateRangeText, type ReferralSettings, type Tier } from '@/lib/referrals';
import { termsState } from '@/lib/referralTracking';
import { cn } from '@/lib/utils';
import { buildPolicyCards } from './policyContent';

interface Props {
  s: ReferralSettings;
  tiers: Tier[];
  passMark: number;
  money: (v: number) => string;
  date: (iso: string | null | undefined) => string;
  /** From my_referral_tracking (null while the SQL is not applied: falls back to the overview's accepted version). */
  terms: TrackingInfo['terms'];
  acceptedVersion: number | null;
  /** Re-accept is offered only after the AI interview is passed (same order as the activation steps). */
  canAccept: boolean;
  onDone: () => void;
}

/** "Programme policy": short numbered, collapsible cards in simple words, plus the terms version the consultant accepted. */
export default function ReferralPolicyCards({ s, tiers, passMark, money, date, terms, acceptedVersion, canAccept, onDone }: Props) {
  const { t } = useTranslation();
  const [ackOpen, setAckOpen] = useState(false);
  const cards = buildPolicyCards(t, { s, tiers, money });
  const current = terms?.current_version ?? s.terms_version;
  const accepted = terms?.accepted_version ?? acceptedVersion;
  const state = termsState(accepted, current);
  const draft = terms ? terms.is_draft : true;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
        <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="font-medium">{t('reft.terms_version', 'Terms version {{v}}, last updated {{date}}', { v: current, date: date(terms?.published_at ?? s.terms_published_at) })}</span>
        {draft && <Badge variant="outline" className="text-[10px]">{t('reft.draft_legal', 'Draft pending legal review')}</Badge>}
        <span className="flex-1" />
        <Link to="/referral-terms" className="font-medium text-primary underline-offset-2 hover:underline">{t('refr.full_terms', 'Read full terms')}</Link>
      </div>

      <p role="status" className={cn('flex flex-wrap items-center gap-2 rounded-xl p-3 text-sm',
        state === 'current' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
        {state === 'current' && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
        <span className="font-medium">
          {state === 'current'
            ? (terms?.accepted_at
              ? t('reft.accepted_on', 'You accepted version {{v}} on {{date}}.', { v: accepted, date: date(terms.accepted_current_at ?? terms.accepted_at) })
              : t('reft.accepted', 'You accepted version {{v}}.', { v: accepted }))
            : state === 'outdated'
              ? t('reft.accepted_old', 'You accepted version {{old}}{{when}}. Version {{v}} is new - please read and accept it again.', {
                old: accepted, v: current, when: terms?.accepted_at ? ` (${date(terms.accepted_at)})` : '' })
              : t('reft.not_accepted', 'You have not accepted the programme terms yet.')}
        </span>
        {state !== 'current' && canAccept && (
          <Button size="sm" variant="outline" className="ms-auto" onClick={() => setAckOpen(true)}>
            <RefreshCw className="me-1 h-3.5 w-3.5" aria-hidden="true" />
            {state === 'outdated' ? t('reft.reaccept', 'Accept the new version') : t('refr.c_terms_btn', 'Accept the terms')}
          </Button>
        )}
        {state !== 'current' && !canAccept && <span className="text-xs">{t('refr.c_terms_locked', 'Opens after you pass the AI interview.')}</span>}
      </p>

      <Accordion type="multiple" className="grid gap-2 md:grid-cols-2">
        {cards.map((c, i) => (
          <AccordionItem key={c.id} value={c.id} className="rounded-xl border border-border/60 bg-card px-3 [&]:border-b">
            <AccordionTrigger className="gap-3 py-3 text-start text-sm font-semibold hover:no-underline">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary" aria-hidden="true">{i + 1}</span>
                <span className="min-w-0">{c.title}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ul className="list-disc space-y-1 ps-9 text-sm text-muted-foreground">
                {c.lines.map((l) => <li key={l} dir="auto">{l}</li>)}
              </ul>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <Dialog open={ackOpen} onOpenChange={setAckOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t('refr.c_terms_btn', 'Accept the terms')}</DialogTitle></DialogHeader>
          <ReferralAckPanel version={current} rateText={rateRangeText(tiers)} months={s.months} passMark={passMark} source="page"
            onDone={() => { setAckOpen(false); onDone(); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
