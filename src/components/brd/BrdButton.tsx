import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBrd } from '@/hooks/useBrd';

/**
 * "Create BRD" / "Open BRD (v3)" on the ticket page. Shown only to people the database lets in: the ticket's client
 * and admins (always, while the feature is on; admins also while it is off), assigned consultants with the NDA once a
 * version is attached. Hidden when the feature is not installed yet.
 */
export default function BrdButton({ ticketId, area }: { ticketId: string; area: 'client' | 'admin' | 'consultant' }) {
  const { t } = useTranslation();
  const { data } = useBrd(ticketId);
  if (!data?.role) return null;
  const writer = data.role === 'client' || data.role === 'admin';
  if (!data.enabled && data.role !== 'admin') return null;
  const latest = writer ? data.brd?.latest_version ?? 0 : data.brd?.shared_version ?? (data.versions ?? [])[0]?.version ?? 0;
  if (!writer && latest === 0) return null;
  if (writer && !data.brd && !data.can_write) return null;
  const to = area === 'admin' ? `/admin/tickets/${ticketId}/brd` : area === 'consultant' ? `/consultant/cases/${ticketId}/brd` : `/client/tickets/${ticketId}/brd`;
  const label = data.brd ? (latest > 0 ? t('brd.button.open', { v: latest }) : t('brd.button.openDraft')) : t('brd.button.create');
  return (
    <Button asChild size="sm" className="h-8 text-xs gap-1.5 gradient-primary border-0">
      <Link to={to}><FileText className="w-3.5 h-3.5" /> {label}</Link>
    </Button>
  );
}
