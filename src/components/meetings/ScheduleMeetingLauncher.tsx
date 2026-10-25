import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, Info, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ScheduleMeetingDialog from '@/components/client/ScheduleMeetingDialog';
import { scheduleBlock, scheduleBlockText, type ScheduleBlock } from '@/lib/meetingSchedule';

interface TicketChoice {
  id: string;
  title: string;
  status: string | null;
  client_id: string;
  consultant_id: string | null;
  block: ScheduleBlock | null;
}

/** Requests the signed-in person may schedule a meeting for (clients: own requests; consultants: assigned requests). */
async function loadChoices(role: 'client' | 'consultant'): Promise<TicketChoice[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  if (role === 'client') {
    const { data: tickets } = await supabase.from('tickets').select('id, title, status, client_id, consultant_id')
      .eq('client_id', user.id).neq('status', 'closed').order('updated_at', { ascending: false }).limit(50);
    const list = tickets ?? [];
    const ids = list.map(t => t.id);
    const counts = new Map<string, number>();
    if (ids.length) {
      const { data: rows } = await supabase.from('ticket_assignments').select('ticket_id').in('ticket_id', ids).eq('status', 'active');
      for (const r of rows ?? []) counts.set(r.ticket_id, (counts.get(r.ticket_id) ?? 0) + 1);
    }
    return list.map(t => ({ ...t, block: scheduleBlock({ role: 'client', hasConsultant: !!t.consultant_id, activeAssignments: counts.get(t.id) ?? 0, status: t.status, isOwner: true }) }));
  }
  const { data: me } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
  if (!me) return [];
  const { data: assigns } = await supabase.from('ticket_assignments').select('ticket_id').eq('consultant_id', me.id).eq('status', 'active');
  const assigned = new Set((assigns ?? []).map(a => a.ticket_id));
  const { data: own } = await supabase.from('tickets').select('id, title, status, client_id, consultant_id').eq('consultant_id', me.id)
    .neq('status', 'closed').order('updated_at', { ascending: false }).limit(50);
  const extraIds = [...assigned].filter(id => !(own ?? []).some(t => t.id === id));
  const { data: extra } = extraIds.length
    ? await supabase.from('tickets').select('id, title, status, client_id, consultant_id').in('id', extraIds).neq('status', 'closed')
    : { data: [] as TicketChoice[] };
  return [...(own ?? []), ...(extra ?? [])].map(t => ({ ...t, block: scheduleBlock({ role: 'consultant', hasConsultant: true, activeAssignments: 1, status: t.status, isAssigned: true }) }));
}

/**
 * "Schedule meeting" on pages without a request (Sessions, Video sessions, Messages, consultant Messages and Calendar):
 * the person first picks the request, then the same Schedule meeting dialog opens. Requests that can not have a meeting
 * yet are listed with the reason, so the button is never silently dead.
 */
export default function ScheduleMeetingLauncher({ role, className }: { role: 'client' | 'consultant'; className?: string }) {
  const { i18n } = useTranslation();
  const lang = i18n?.language?.startsWith('ar') ? 'ar' : 'en';
  const [pickOpen, setPickOpen] = useState(false);
  const [chosen, setChosen] = useState<TicketChoice | null>(null);
  const { data: choices = [], isLoading } = useQuery({
    queryKey: ['meeting-ticket-choices', role],
    queryFn: () => loadChoices(role),
    enabled: pickOpen,
  });
  const ready = choices.filter(c => !c.block);
  const waiting = choices.filter(c => c.block);

  return (
    <>
      <Button size="sm" className={className ?? 'gradient-primary border-0 gap-1.5'} onClick={() => setPickOpen(true)} data-testid="schedule-meeting-launcher">
        <CalendarDays className="h-4 w-4" aria-hidden="true" /> {lang === 'ar' ? 'جدولة اجتماع' : 'Schedule meeting'}
      </Button>
      <Dialog open={pickOpen} onOpenChange={setPickOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-accent" aria-hidden="true" />{lang === 'ar' ? 'لأي طلب هذا الاجتماع؟' : 'Which request is this meeting for?'}</DialogTitle>
            <DialogDescription>{lang === 'ar' ? 'تتم الاجتماعات دائمًا ضمن طلب، مع المستشارين المعيّنين عليه.' : 'Meetings always belong to a request, with the consultants assigned to it.'}</DialogDescription>
          </DialogHeader>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground"><Loader2 className="me-2 h-4 w-4 animate-spin" />{lang === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</div>
          ) : choices.length === 0 ? (
            <div className="space-y-3 py-4 text-center text-sm text-muted-foreground" data-testid="launcher-empty">
              <p>{role === 'client'
                ? (lang === 'ar' ? 'ليس لديك طلب مفتوح بعد. أنشئ طلبًا وأرسله إلى مستشار، ثم جدول الاجتماع.' : 'You have no open request yet. Create a request and send it to a consultant, then schedule the meeting.')
                : (lang === 'ar' ? 'لست معيّنًا على أي طلب مفتوح حاليًا.' : 'You are not assigned to any open request right now.')}</p>
              {role === 'client' && <Button asChild size="sm" variant="outline"><Link to="/client/new-request">{lang === 'ar' ? 'طلب جديد' : 'New request'}</Link></Button>}
            </div>
          ) : (
            <div className="space-y-3">
              <ul className="space-y-1.5">
                {ready.map(c => (
                  <li key={c.id}>
                    <button type="button" className="flex w-full items-center gap-2 rounded-xl border border-border/60 p-3 text-start text-sm hover:border-accent/50 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => { setChosen(c); setPickOpen(false); }}>
                      <span className="flex-1 truncate font-medium text-foreground">{c.title}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              {waiting.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">{lang === 'ar' ? 'لا يمكن جدولة اجتماع لها بعد' : 'Not ready for a meeting yet'}</p>
                  <ul className="space-y-1.5">
                    {waiting.map(c => (
                      <li key={c.id} className="rounded-xl border border-dashed border-border/60 p-3 text-sm" data-testid="launcher-blocked">
                        <p className="truncate text-foreground/80">{c.title}</p>
                        <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground"><Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{scheduleBlockText(c.block!, lang)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {chosen && (
        <ScheduleMeetingDialog
          open={!!chosen}
          onOpenChange={(o) => { if (!o) setChosen(null); }}
          ticketId={chosen.id}
          ticketTitle={chosen.title}
          clientId={chosen.client_id}
          consultantId={chosen.consultant_id}
        />
      )}
    </>
  );
}
