import { Badge } from '@/components/ui/badge';
import { statusInfo, type Tone } from '@/lib/timesheet';

export const TONE_CLASSES: Record<Tone, string> = {
  amber: 'bg-amber-100 text-amber-800',
  orange: 'bg-orange-100 text-orange-800',
  green: 'bg-green-100 text-green-800',
  muted: 'bg-muted text-muted-foreground',
};

/** A small coloured label with a text (used for the status of a timesheet and for the state of an invoice). */
export function ToneBadge({ label, tone, title }: { label: string; tone: Tone; title?: string }) {
  return (
    <Badge variant="secondary" className={`text-[10px] ${TONE_CLASSES[tone]}`} title={title}>
      {label}
    </Badge>
  );
}

/** The status of a timesheet in words: Waiting for approval, Changes requested, Approved. */
export default function StatusBadge({ status }: { status: string }) {
  const info = statusInfo(status);
  return <ToneBadge label={info.label} tone={info.tone} title={info.hint} />;
}
