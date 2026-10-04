import { useState } from 'react';
import { Award, ExternalLink, Github, Globe, Linkedin, Loader2, MapPin } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import LinkStatus from '@/components/consultant/LinkStatus';
import { credlyProfileUrl, linkState, normalizeCredlyUsername, normalizeLinkedinUrl, type LinkState } from '@/lib/consultantLinks';
import { placeLabel } from '@/lib/geo';
import { safeHttpUrl } from '@/lib/consultantReview';

export interface TrustFields {
  id: string;
  city?: string | null;
  country?: string | null;
  linkedin_url?: string | null;
  linkedin_checked_at?: string | null;
  credly_username?: string | null;
  credly_checked_at?: string | null;
  github_url?: string | null;
  personal_website?: string | null;
}

interface Props {
  consultant: TrustFields;
  /** True in the demo: nothing can be saved. */
  readOnly?: boolean;
  onChanged?: () => void;
}

type Column = 'linkedin_checked_at' | 'credly_checked_at';

interface RowProps {
  icon: LucideIcon;
  label: string;
  href: string | null;
  state: LinkState;
  busy: boolean;
  readOnly: boolean;
  onCheck: (checked: boolean) => void;
}

function LinkRow({ icon: Icon, label, href, state, busy, readOnly, onCheck }: RowProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid={`trust-${label.toLowerCase()}`}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="w-16 shrink-0 font-medium">{label}</span>
      {href ? (
        <>
          <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline" aria-label={`Open the ${label} page in a new tab`}>
            Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
          <LinkStatus state={state} label={label} />
          {state === 'checked' ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busy || readOnly} onClick={() => onCheck(false)}>
              Remove check
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={busy || readOnly} onClick={() => onCheck(true)}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Mark as checked'}
            </Button>
          )}
        </>
      ) : (
        <span className="text-xs text-muted-foreground">Not given</span>
      )}
    </div>
  );
}

/** For the administrator: the place and the links that a consultant gave, with a button to mark LinkedIn and Credly as checked after the administrator opened them. */
export default function ConsultantTrustPanel({ consultant, readOnly = false, onChanged }: Props) {
  const [busy, setBusy] = useState<Column | null>(null);

  const linkedin = normalizeLinkedinUrl(consultant.linkedin_url);
  const credlyName = normalizeCredlyUsername(consultant.credly_username);
  const credly = credlyProfileUrl(credlyName);
  const github = safeHttpUrl(consultant.github_url);
  const website = safeHttpUrl(consultant.personal_website);
  const place = placeLabel(consultant.city, consultant.country);

  const setChecked = async (column: Column, checked: boolean) => {
    setBusy(column);
    const value = checked ? new Date().toISOString() : null;
    const { error } = await supabase
      .from('consultants')
      .update(column === 'linkedin_checked_at' ? { linkedin_checked_at: value } : { credly_checked_at: value })
      .eq('id', consultant.id);
    setBusy(null);
    if (error) {
      toast.error(error.message || 'Could not save the check.');
      return;
    }
    toast.success(checked ? 'Marked as checked.' : 'The check was removed.');
    onChanged?.();
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-background/50 p-3" data-testid="trust-panel">
      <h4 className="text-xs font-semibold uppercase text-muted-foreground">Place and links</h4>
      <p className="flex items-center gap-1.5 text-sm" data-testid="trust-place">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {place || 'No city chosen, so the consultant is not on the map.'}
      </p>
      <LinkRow icon={Linkedin} label="LinkedIn" href={linkedin} state={linkState(linkedin, consultant.linkedin_checked_at)} busy={busy === 'linkedin_checked_at'} readOnly={readOnly} onCheck={checked => void setChecked('linkedin_checked_at', checked)} />
      <LinkRow icon={Award} label="Credly" href={credly} state={linkState(credlyName, consultant.credly_checked_at)} busy={busy === 'credly_checked_at'} readOnly={readOnly} onCheck={checked => void setChecked('credly_checked_at', checked)} />
      {(github || website) && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {github && (
            <a href={github} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline">
              <Github className="h-3.5 w-3.5" aria-hidden="true" /> GitHub <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline">
              <Globe className="h-3.5 w-3.5" aria-hidden="true" /> Website <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Open the link and check that the name, the photo and the work history are those of the person who applied; only then mark it as checked. LinkedIn and Credly give no automatic proof that a profile belongs to someone. Clients see "linked" until you mark a link as checked, and the check starts again if the consultant changes the link.
      </p>
    </div>
  );
}
