import { BadgeCheck, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { LinkState } from '@/lib/consultantLinks';

interface Props {
  state: LinkState;
  /** "LinkedIn" or "Credly" */
  label: string;
}

/** Says whether a link of a consultant is only given by the consultant ("linked") or was opened and confirmed by the platform team ("checked"). */
export default function LinkStatus({ state, label }: Props) {
  if (state === 'none') return null;
  if (state === 'checked') {
    return (
      <Badge variant="secondary" className="gap-1 bg-green-100 text-[10px] text-green-700" data-testid="link-checked" title="An administrator opened this link and confirmed that it belongs to this consultant.">
        <BadgeCheck className="h-3 w-3" aria-hidden="true" /> {label} checked
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 text-[10px]" data-testid="link-linked" title="Given by the consultant. The platform team has not checked it yet.">
      <Link2 className="h-3 w-3" aria-hidden="true" /> {label} linked
    </Badge>
  );
}
