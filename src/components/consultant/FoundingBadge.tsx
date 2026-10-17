import { Award } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFoundingConsultants } from '@/hooks/useFoundingConsultants';
import { activeAward } from '@/lib/foundingConsultants';
export default function FoundingBadge({ consultantId, numbered = false }: { consultantId?: string; numbered?: boolean }) {
  const { t } = useTranslation();
  const { data } = useFoundingConsultants();
  const award = consultantId ? data?.get(consultantId) : undefined;
  if (!activeAward(award)) return null;
  return <Tooltip><TooltipTrigger asChild><span tabIndex={0} className="inline-flex max-w-full items-center gap-1 rounded-md border border-warning/40 bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
    <Award className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span>{t('founding.badge', 'Founding Consultant')}{numbered && <> <bdi>#{award?.founding_number}</bdi></>}</span>
  </span></TooltipTrigger><TooltipContent>{t('founding.tooltip', 'One of the first 100 verified consultants')}</TooltipContent></Tooltip>;
}
