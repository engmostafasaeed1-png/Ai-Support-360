import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Cpu, Server } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { archForTicket, setTicketSystems, ticketSystems, type CaseArchDoc } from '@/lib/architecture/api';
import type { LandscapeSystem } from '../../../supabase/functions/_shared/archModel';
import { TYPE_TITLES } from '../../../supabase/functions/_shared/archModel';
import ArchStatusBadge from './ArchStatusBadge';

/**
 * On a ticket: the SAP systems it concerns (picked from the company's landscape register, no credentials) and the
 * architecture documents linked to it that this person may open. Renders nothing until the database update exists.
 */
export default function TicketArchitectureCard({ ticketId, docBase }: { ticketId: string; docBase: '/client/solution-architecture' | '/consultant/architecture' | '/admin/architecture' }) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const [docs, setDocs] = useState<CaseArchDoc[] | null>(null);
  const [sys, setSys] = useState<{ can_edit: boolean; systems: Array<LandscapeSystem & { id: string }>; available: Array<LandscapeSystem & { id: string }> } | null>(null);
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState<string[]>([]);

  const load = async () => {
    const [d, s] = await Promise.all([archForTicket(ticketId), ticketSystems(ticketId)]);
    if (!d.error) setDocs(d.data ?? []);
    if (!s.error && s.data) { setSys(s.data); setPick(s.data.systems.map((x) => x.id)); }
  };
  useEffect(() => { void load(); }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!docs && !sys) return null;
  if ((docs?.length ?? 0) === 0 && (sys?.systems.length ?? 0) === 0 && !sys?.can_edit) return null;

  const save = async () => {
    const r = await setTicketSystems(ticketId, pick);
    if (r.error) { toast.error(r.error.message); return; }
    setEditing(false);
    void load();
  };

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Cpu className="h-4 w-4 text-primary" aria-hidden />{t('arch.ticketCard.title')}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {sys && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Server className="h-3.5 w-3.5" aria-hidden />{t('arch.ticketCard.systems')}</p>
              {sys.can_edit && !editing && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditing(true)}>{t('arch.common.edit')}</Button>}
            </div>
            {editing ? (
              <div className="space-y-2">
                {sys.available.length === 0 ? <p className="text-xs text-muted-foreground">{t('arch.ticketCard.noRegister')}</p> : sys.available.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-xs">
                    <Checkbox checked={pick.includes(s.id)} onCheckedChange={(v) => setPick(v ? [...pick, s.id] : pick.filter((x) => x !== s.id))} />
                    {s.name} {s.sid && <span className="font-mono">({s.sid})</span>} · {s.role}
                  </label>
                ))}
                <div className="flex gap-1 justify-end">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>{t('common.cancel', 'Cancel')}</Button>
                  <Button size="sm" className="h-7 text-xs" onClick={() => void save()}>{t('arch.common.save')}</Button>
                </div>
              </div>
            ) : sys.systems.length === 0 ? <p className="text-xs text-muted-foreground">{t('arch.ticketCard.noSystems')}</p> : (
              <div className="flex flex-wrap gap-1">{sys.systems.map((s) => <Badge key={s.id} variant="outline" className="text-[10px]">{s.name}{s.sid ? ` · ${s.sid}` : ''} · {s.role}</Badge>)}</div>
            )}
          </div>
        )}
        {docs && docs.length > 0 && (
          <ul className="space-y-1" aria-label={t('arch.refs.linkedDocs')}>
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <Link to={`${docBase}/${d.id}`} className="text-primary hover:underline truncate">{d.title}</Link>
                <span className="text-[10px] text-muted-foreground">{TYPE_TITLES[d.type][ar ? 'ar' : 'en']} · v{d.latest_version}</span>
                <ArchStatusBadge status={d.status} className="ms-auto" />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
