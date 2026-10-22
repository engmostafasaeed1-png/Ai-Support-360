import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Circle, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ReferralAckPanel from '@/components/referral/ReferralAckPanel';
import type { MyInvite, ReferralOverview } from '@/hooks/useReferralProgram';
import { CHIP_LABEL, CHIP_TONE, formatRate, rateRangeText, settingsTiers, type ActivationChip } from '@/lib/referrals';
import { cn } from '@/lib/utils';

export function ChipBadge({ chip }: { chip: string }) {
  const { t } = useTranslation();
  const c = (chip in CHIP_LABEL ? chip : 'waiting_them') as ActivationChip;
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', CHIP_TONE[c])}>{t(`refz.chip_${c}`, CHIP_LABEL[c])}</span>;
}

/** Plain next step for one side (mirrors referral_next_text). */
export function useNextStepText() {
  const { t } = useTranslation();
  return (step: string, other: string, passMark: number) => {
    if (step === 'pass_interview') return t('refz.next_pass', 'Pass the AI interview (score at least {{pass}}).', { pass: passMark });
    if (step === 'acknowledge') return t('refz.next_ack', 'Accept the referral terms on the Refer & earn page.');
    if (step === 'wait_other') return t('refz.next_wait', 'Waiting for {{name}} to pass the AI interview and accept the terms.', { name: other });
    return t('refz.next_none', 'Nothing to do.');
  };
}

function Step({ done, label, children }: { done: boolean; label: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', done ? 'text-foreground' : 'text-muted-foreground')}>
          {label}<span className="sr-only">{done ? ' - done' : ' - to do'}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

/** Referrer locked state: interview passed -> terms acknowledged -> active. */
export function ReferrerActivationCard({ ov, onDone }: { ov: ReferralOverview; onDone: () => void }) {
  const { t } = useTranslation();
  const a = ov.activation;
  return (
    <Card className="rounded-2xl border-primary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{t('refz.locked_title', 'Pass the AI interview to activate your referral programme')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('refz.locked_sub', 'Your code is ready, but sharing and earning start only after these steps.')}</p>
      </CardHeader>
      <CardContent>
        <ol className="space-y-4">
          <Step done={a.interview_passed} label={t('refz.step_interview', 'AI interview passed (score at least {{pass}})', { pass: a.pass_mark })}>
            {!a.interview_passed && (
              <div className="mt-2 space-y-2">
                {a.best_score != null && <p className="text-xs text-muted-foreground">{t('refz.best_score', 'Your best score so far: {{score}}. You can retake it under the normal interview rules.', { score: Math.round(a.best_score) })}</p>}
                <Button asChild size="sm" className="rounded-xl"><Link to="/consultant/interviews?start=1"><Play className="me-1 h-4 w-4" />{t('refz.start_interview', 'Start AI interview')}</Link></Button>
              </div>
            )}
          </Step>
          <Step done={a.acknowledged} label={t('refz.step_ack', 'Referral terms acknowledged')}>
            {a.interview_passed && !a.acknowledged && (
              <div className="mt-2">
                <ReferralAckPanel version={ov.settings.terms_version} rateText={rateRangeText(settingsTiers(ov.settings))} months={ov.settings.months} passMark={a.pass_mark} source="page" onDone={onDone} />
              </div>
            )}
          </Step>
          <Step done={a.active} label={t('refz.step_active', 'Referral programme active: share your link')} />
        </ol>
      </CardContent>
    </Card>
  );
}

/** For a consultant who registered with someone's code: who invited them (masked), steps and the next step. */
export function InviteCard({ invite, onDone }: { invite: MyInvite; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const next = useNextStepText();
  const date = (iso: string | null) => (iso ? new Intl.DateTimeFormat(i18n.language?.startsWith('ar') ? 'ar-EG' : 'en-US', { dateStyle: 'medium' }).format(new Date(iso)) : '');
  const pending = invite.activation_status === 'pending';
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t('refz.invite_title', 'You were invited by {{name}}', { name: invite.referrer_name })}</CardTitle>
          <ChipBadge chip={invite.chip} />
        </div>
        <p className="text-sm text-muted-foreground">
          {invite.activation_status === 'active'
            ? t('refz.invite_active', 'Your referral is active since {{date}}.', { date: date(invite.activated_at) })
            : invite.activation_status === 'expired'
              ? t('refz.invite_expired', 'This referral has expired. An administrator can revive it.')
              : t('refz.invite_pending', 'The referral programme becomes active after you and your referrer pass the AI interview. Deadline: {{date}}.', { date: date(invite.activation_expires_at) })}
        </p>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          <Step done={!!invite.i_passed_at} label={t('refz.t_you_passed', 'You passed the AI interview')}>
            {!invite.i_passed_at && pending && <Button asChild size="sm" className="mt-2 rounded-xl"><Link to="/consultant/interviews?start=1"><Play className="me-1 h-4 w-4" />{t('refz.start_interview', 'Start AI interview')}</Link></Button>}
          </Step>
          <Step done={!!invite.i_acknowledged_at} label={t('refz.t_you_acked', 'You accepted the referral terms')}>
            {!invite.i_acknowledged_at && pending && (
              <div className="mt-2"><ReferralAckPanel version={invite.terms_version} rateText={invite.tiers?.length ? rateRangeText(invite.tiers) : formatRate(invite.rate_percent)} months={invite.months} passMark={invite.pass_mark} source="popup" onDone={onDone} /></div>
            )}
          </Step>
          <Step done={invite.they_passed && invite.they_acknowledged} label={t('refz.t_they_ready', '{{name}} passed the AI interview and accepted the terms', { name: invite.referrer_name })} />
          <Step done={invite.activation_status === 'active'} label={t('refz.t_active', 'Referral active')} />
        </ol>
        {pending && <p className="mt-3 text-xs text-muted-foreground">{t('refz.your_next', 'Your next step:')} {next(invite.my_next, invite.referrer_name, invite.pass_mark)}</p>}
      </CardContent>
    </Card>
  );
}
