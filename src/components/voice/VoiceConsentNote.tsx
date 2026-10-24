import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shown before voice is used in the AI interview: what happens to the recording. */
export default function VoiceConsentNote({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={cn('flex items-start gap-2 text-xs leading-relaxed', className)}>
      <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {t('voice.consent', 'When you answer by voice, your recording is turned into text by an AI speech service so the interviewer can read it. The recording is processed only for that and is not kept; the written text of your answers is saved with the interview. You can check and edit the text before sending, or type instead.')}
      </span>
    </p>
  );
}
