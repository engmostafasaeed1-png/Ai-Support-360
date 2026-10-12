import { useState } from 'react';
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

export default function ProfilePage() {
  const { t } = useTranslation();
  const { data: profile, isLoading } = useConsultantProfile();
  const [reinterviewOpen, setReinterviewOpen] = useState(false);
  if (isLoading) return <Skeleton className="h-80 w-full" />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">{t('consultant_profile_hub.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <AvailabilityToggle variant="pill" />
          <Button variant="outline" size="sm" onClick={() => setReinterviewOpen(true)}>
            <RotateCcw className="w-4 h-4 me-1" /> {t('interview.request_reinterview', 'Request Re-Interview')}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-4"><AvatarUpload /><h2 className="text-lg font-semibold">{profile?.display_name}</h2></div>
      <ConsultantOnboarding embedded />
      <section id="payout-details" className="scroll-mt-20">
        <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
          <Landmark className="w-5 h-5 text-primary" /> Payout bank details
        </h2>
        <PayoutDetailsCard />
      </section>
      <section id="interview-history">
        <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" /> {t('interview.history', 'Interview History & Results')}
        </h2>
        <InterviewTranscript consultantId={profile?.id || ''} viewMode="consultant" />
      </section>
      <ReinterviewDialog open={reinterviewOpen} onOpenChange={setReinterviewOpen}
        consultantId={profile?.id || ''} consultantName={profile?.display_name || ''} />
    </div>
  );
}
