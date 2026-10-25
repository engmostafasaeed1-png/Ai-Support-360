import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { ArchStatus } from '../../../supabase/functions/_shared/archModel';
import { cn } from '@/lib/utils';

const TONE: Record<ArchStatus, string> = {
  draft: 'bg-muted text-muted-foreground border-border',
  in_review: 'bg-accent/10 text-accent border-accent/40',
  approved: 'bg-primary/10 text-primary border-primary/30',
  superseded: 'bg-secondary text-secondary-foreground border-border',
  archived: 'bg-muted text-muted-foreground border-dashed border-border',
};

export default function ArchStatusBadge({ status, className }: { status: ArchStatus; className?: string }) {
  const { t } = useTranslation();
  return <Badge variant="outline" className={cn('text-[10px] font-medium', TONE[status], className)}>{t(`arch.status.${status}`)}</Badge>;
}
