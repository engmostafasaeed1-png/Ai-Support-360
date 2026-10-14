import { useSessionReady } from '@/hooks/useSessionReady';
import { fill } from '@/lib/i18nFill';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Compass, Rocket, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyPayoutDetails } from '@/hooks/useBilling';
import { useTelegramStatus } from '@/hooks/useTelegram';
import { useTourProgress } from '@/hooks/useTourProgress';
import { payoutReady } from '@/lib/payoutDisclaimer';
import { profileCompleteness } from '@/lib/profileCompleteness';
import { GETTING_STARTED_DISMISSED_KEY } from '@/lib/tour';
import { useConsultantTour } from '@/components/tour/ConsultantTour';

const db = supabase as any;

// Explicit columns only: never select('*') on consultants.
const COLUMNS = 'id, sap_roles, seniority_level, total_sap_years, sap_technologies, industries, customer_segments, vertical_solutions, localization_countries, localization_solutions, project_types, deployment_experience, project_scale, work_modes, working_week, language_levels, ai_interview_completed_at, new_case_alerts';

export interface GettingStartedInput {
  completenessPercent: number;
  skills: number;
  interviewDone: boolean;
  slots: number;
  payoutReady: boolean;
  alertsOn: boolean;
  bids: number;
}

export interface GettingStartedItem { key: string; label: string; done: boolean; to: string }

/** The checklist items in order, with their English labels and target pages. */
export function gettingStartedItems(i: GettingStartedInput): GettingStartedItem[] {
  return [
    { key: 'profile', label: 'Complete your profile', done: i.completenessPercent >= 80, to: '/consultant/profile' },
    { key: 'expertise', label: 'Add your SAP expertise', done: i.skills > 0, to: '/consultant/profile#expertise' },
    { key: 'interview', label: 'Take the AI interview', done: i.interviewDone, to: '/consultant/interviews' },
    { key: 'availability', label: 'Set your availability', done: i.slots > 0, to: '/consultant/profile#availability' },
    { key: 'bank', label: 'Add your bank details', done: i.payoutReady, to: '/consultant/profile#payout-details' },
    { key: 'alerts', label: 'Turn on alerts', done: i.alertsOn, to: '/consultant/settings' },
    { key: 'bid', label: 'Place your first bid', done: i.bids > 0, to: '/consultant/open-tickets' },
  ];
}

function useGettingStartedData() {
  const payout = useMyPayoutDetails();
  const telegram = useTelegramStatus();
  const signedIn = useSessionReady().signedIn;
  const base = useQuery({
    enabled: signedIn,
    queryKey: ['getting-started'],
    retry: false,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: c } = await db.from('consultants').select(COLUMNS).eq('user_id', user.id).maybeSingle();
      if (!c) return null;
      const count = async (table: string) => {
        try {
          const { count: n } = await db.from(table).select('id', { count: 'exact', head: true }).eq('consultant_id', c.id);
          return n ?? 0;
        } catch { return 0; }
      };
      const [skills, slots, bids] = await Promise.all([count('consultant_skills'), count('availability_slots'), count('proposals')]);
      let pushDevices = 0;
      try {
        const { data } = await db.rpc('push_my_status', { _endpoint: null });
        pushDevices = typeof data?.devices === 'number' ? data.devices : 0;
      } catch { /* not available */ }
      return { c, skills, slots, bids, pushDevices };
    },
  });
  if (base.isLoading || payout.isLoading) return { loading: true as const, input: null };
  const d = base.data;
  if (!d) return { loading: false as const, input: null };
  const ready = payoutReady(payout.data?.details);
  const percent = profileCompleteness({ ...d.c, skills_count: d.skills, payout_ready: ready }).percent;
  const input: GettingStartedInput = {
    completenessPercent: percent,
    skills: d.skills,
    interviewDone: !!d.c.ai_interview_completed_at,
    slots: d.slots,
    payoutReady: ready,
    alertsOn: d.c.new_case_alerts === true || d.pushDevices > 0 || telegram.data?.active === true,
    bids: d.bids,
  };
  return { loading: false as const, input };
}

export default function GettingStartedCard() {
  const { t } = useTranslation();
  const { loading, input } = useGettingStartedData();
  const dismissed = useTourProgress(GETTING_STARTED_DISMISSED_KEY);
  const tour = useConsultantTour();

  if (loading || dismissed.isLoading) return <Skeleton className="h-48 rounded-2xl" data-tour="getting-started" />;
  if (!input || dismissed.progress?.completed_at) return null;

  const items = gettingStartedItems(input);
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const allDone = done === total;

  return (
    <Card className="rounded-2xl border-border/50" data-tour="getting-started">
      <CardHeader className="pb-2 flex flex-row items-center gap-2 space-y-0">
        <Rocket className="w-5 h-5 text-primary" aria-hidden="true" />
        <CardTitle className="text-base">{t('getting_started.title', 'Getting started')}</CardTitle>
        <Button variant="outline" size="sm" className="ms-auto gap-1" onClick={() => tour.start()}>
          <Compass className="w-4 h-4" aria-hidden="true" /> {t('getting_started.take_tour', 'Take the tour')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{fill(t('getting_started.progress', '{{done}} of {{total}} done', { done, total }), { done, total })}</p>
          <Progress value={Math.round((100 * done) / total)} className="h-1.5" aria-label={fill(t('getting_started.progress', '{{done}} of {{total}} done', { done, total }), { done, total })} />
        </div>
        {allDone ? (
          <div className="flex items-center gap-3 rounded-xl bg-primary/5 border border-primary/15 p-3">
            <CheckCircle2 className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
            <p className="flex-1 text-sm font-medium text-foreground">{t('getting_started.all_set', "You're all set")}</p>
            <Button size="sm" variant="ghost" className="gap-1" onClick={() => void dismissed.save(0, 'completed')}>
              <X className="w-4 h-4" aria-hidden="true" /> {t('getting_started.dismiss', 'Dismiss')}
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {items.map((item) => (
              <li key={item.key} className="flex items-center gap-3 py-2">
                {item.done
                  ? <CheckCircle2 className="w-4 h-4 text-primary shrink-0" aria-label={t('getting_started.done', 'Done')} />
                  : <span className="w-4 h-4 rounded-full border-2 border-muted-foreground/40 shrink-0" aria-hidden="true" />}
                <span className={item.done ? 'flex-1 text-sm text-muted-foreground line-through' : 'flex-1 text-sm text-foreground'}>
                  {t(`getting_started.item_${item.key}`, item.label)}
                </span>
                {!item.done && (
                  <Button asChild size="icon" variant="ghost" className="h-7 w-7">
                    <Link to={item.to} aria-label={t(`getting_started.item_${item.key}`, item.label)}>
                      <ChevronRight className="w-4 h-4 rtl:rotate-180" aria-hidden="true" />
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
