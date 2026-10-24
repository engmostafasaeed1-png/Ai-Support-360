// Opt-in, default OFF: "Allow us to keep my voice recording for 90 days to improve recognition". Shown only when the
// owner switched training recordings on (docs/sql/interview-voice-learning.sql). The choice is stored with the consent
// text version; unticking withdraws it and deletes every kept recording.
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useMyVoiceLearning } from '@/hooks/useMyVoiceLearning';
import { AUDIO_CONSENT_VERSION } from '../../../supabase/functions/_shared/voiceLearning';

export default function VoiceTrainingConsent({ interviewId, className }: { interviewId?: string | null; className?: string }) {
  const { t } = useTranslation();
  const { data, setConsent } = useMyVoiceLearning();
  if (!data?.training_audio_offered) return null;
  const checked = !!data.consent?.current;
  const days = data.retention_days ?? 90;
  const change = async (on: boolean) => {
    const r = await setConsent(on, interviewId ?? null);
    if (!r.ok) { toast.error(t('voice.learn.consent_error', 'Your choice could not be saved. Please try again.')); return; }
    if (!on && r.deleted > 0) toast.success(t('voice.learn.consent_withdrawn', 'Withdrawn. Your {{n}} kept recordings will be deleted.', { n: r.deleted }));
  };
  return (
    <label className={cn('flex items-start gap-2 text-xs leading-relaxed cursor-pointer', className)}>
      <Checkbox checked={checked} onCheckedChange={(v) => void change(v === true)} className="mt-0.5" aria-describedby="voice-training-consent-hint" />
      <span>
        <span className="block font-medium">{t('voice.learn.consent_label', 'Allow us to keep my voice recording for {{days}} days to improve recognition', { days })}</span>
        <span id="voice-training-consent-hint" className="block opacity-80">
          {t('voice.learn.consent_hint', 'Optional. Recordings are stored privately, used only for our own accuracy tests, never shared, and deleted after {{days}} days or as soon as you untick this. Your interview does not depend on it.', { days })}
        </span>
        <span className="sr-only">{AUDIO_CONSENT_VERSION}</span>
      </span>
    </label>
  );
}
