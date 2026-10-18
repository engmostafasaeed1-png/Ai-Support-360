import ProfileImportance from '@/components/consultant/saving/ProfileImportance';
import FoundingBadge from '@/components/consultant/FoundingBadge';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RotateCcw, Brain, Landmark } from 'lucide-react';
import PayoutDetailsCard from '@/components/consultant/PayoutDetailsCard';
import InterviewTranscript from '@/components/consultant/InterviewTranscript';
import AvatarUpload from '@/components/profile/AvatarUpload';
import ReinterviewDialog from '@/components/consultant/ReinterviewDialog';
import AvailabilityToggle from '@/components/consultant/AvailabilityToggle';
import { useConsultantProfile } from '@/hooks/useConsultantProfile';
import ConsultantOnboarding from '@/components/consultant/onboarding/ConsultantOnboarding';
import { EmbeddedGuideProvider, EmbeddedGuideSwitch, EmbeddedGuideCard } from '@/components/consultant/onboarding/EmbeddedGuides';
import { FieldHint } from '@/components/consultant/onboarding/OnboardingGuidePanel';

export default function ProfilePage() {
  const { t } = useTranslation();
  const { data: profile, isLoading } = useConsultantProfile();
  const [reinterviewOpen, setReinterviewOpen] = useState(false);
  const { hash, search } = useLocation();
  useEffect(() => {
    if (isLoading || hash !== '#payout-details') return;
    const id = setTimeout(() => document.getElementById('payout-details')?.scrollIntoView({ block: 'start' }), 300);
    return () => clearTimeout(id);
  }, [isLoading, hash]);
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  return (
    <EmbeddedGuideProvider setup={new URLSearchParams(search).get('section') === 'setup'}><ProfileImportance><div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">{t('consultant_profile_hub.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <EmbeddedGuideSwitch />
          <AvailabilityToggle variant="pill" />
          <Button variant="outline" size="sm" onClick={() => setReinterviewOpen(true)}>
            <RotateCcw className="w-4 h-4 me-1" /> {t('interview.request_reinterview', 'Request Re-Interview')}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-4"><AvatarUpload /><div className="space-y-1"><h2 className="text-lg font-semibold">{profile?.display_name}</h2><FoundingBadge consultantId={profile?.id} numbered /></div></div>
      <ConsultantOnboarding embedded />
      <section id="payout-details" className="scroll-mt-20">
        <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
          <Landmark className="w-5 h-5 text-primary" /> Payout bank details
        </h2>
        <PayoutDetailsCard />
      </section>
      <section id="interview-history">
        <EmbeddedGuideCard section="interview-history" stepKey="interview" />
        <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" /> {t('interview.history', 'Interview History & Results')}
          <FieldHint field="interview" />
        </h2>
        <InterviewTranscript consultantId={profile?.id || ''} viewMode="consultant" />
      </section>
      <ReinterviewDialog open={reinterviewOpen} onOpenChange={setReinterviewOpen}
        consultantId={profile?.id || ''} consultantName={profile?.display_name || ''} />
    </div></ProfileImportance></EmbeddedGuideProvider>
  );
}
