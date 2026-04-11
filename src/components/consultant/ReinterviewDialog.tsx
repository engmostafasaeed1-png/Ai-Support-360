import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Bot, MapPin, Video, Loader2 } from 'lucide-react';
import TimeSlotPicker, { type ProposedSlot } from '@/components/ui/TimeSlotPicker';
import { format } from 'date-fns';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultantId: string;
  consultantName?: string;
}

const interviewTypes = [
  { value: 'ai' as const, icon: Bot, labelKey: 'interview.type_ai', descKey: 'interview.type_ai_desc' },
  { value: 'physical' as const, icon: MapPin, labelKey: 'interview.type_physical', descKey: 'interview.type_physical_desc' },
  { value: 'online' as const, icon: Video, labelKey: 'interview.type_online', descKey: 'interview.type_online_desc' },
];

export default function ReinterviewDialog({ open, onOpenChange, consultantId, consultantName }: Props) {
  const { t } = useTranslation();
  const [selectedType, setSelectedType] = useState<'ai' | 'physical' | 'online'>('ai');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [proposedSlots, setProposedSlots] = useState<ProposedSlot[]>([]);

  const needsScheduling = selectedType === 'physical' || selectedType === 'online';

  const handleSubmit = async () => {
    if (needsScheduling && proposedSlots.length === 0) {
      toast.error(t('interview.select_time_slots', 'Please propose at least one time slot'));
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Format proposed slots for storage
      const slotsData = proposedSlots.map(s => ({
        date: format(s.date, 'yyyy-MM-dd'),
        start_time: s.startTime,
        end_time: s.endTime,
      }));

      // Create interview session
      const { data: session, error: sessionError } = await supabase
        .from('interview_sessions')
        .insert({
          consultant_id: consultantId,
          status: 'pending',
          interview_type: selectedType,
          requested_by: user.id,
          ai_summary: notes || null,
          skill_results: needsScheduling ? { proposed_slots: slotsData } : null,
        } as any)
        .select('id')
        .single();

      if (sessionError) throw sessionError;

      // Get consultant's user_id for notification
      const { data: consultant } = await supabase
        .from('consultants')
        .select('user_id')
        .eq('id', consultantId)
        .single();

      if (consultant?.user_id) {
        const typeLabel = t(`interview.type_${selectedType}`, selectedType);
        const slotsText = proposedSlots.length > 0
          ? ` Proposed times: ${proposedSlots.map(s => `${format(s.date, 'MMM d')} ${s.startTime}-${s.endTime}`).join(', ')}`
          : '';
        await supabase.from('notifications').insert({
          user_id: consultant.user_id,
          title: t('interview.reinterview_requested', 'Re-Interview Requested'),
          body: t('interview.reinterview_body', `You have been requested for a ${typeLabel} re-interview.${slotsText}`, { type: typeLabel }),
          type: 'interview',
          link: '/consultant/interviews',
        });
      }

      // Notify admins about the scheduling request
      if (needsScheduling) {
        const { data: admins } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('role', 'admin');

        if (admins) {
          for (const admin of admins) {
            await supabase.from('notifications').insert({
              user_id: admin.user_id,
              title: 'Interview Scheduling Request',
              body: `A ${selectedType} re-interview has been requested for ${consultantName || 'a consultant'} with ${proposedSlots.length} proposed time slot(s).`,
              type: 'interview',
              link: '/admin/tickets',
            });
          }
        }
      }

      toast.success(t('interview.reinterview_sent', 'Re-interview request sent'));
      setNotes('');
      setSelectedType('ai');
      setProposedSlots([]);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to request re-interview');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('interview.request_reinterview', 'Request Re-Interview')}</DialogTitle>
          <DialogDescription>
            {consultantName
              ? t('interview.reinterview_for', `Schedule a re-interview for ${consultantName}`, { name: consultantName })
              : t('interview.reinterview_desc', 'Choose the interview type and send the request')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>{t('interview.select_type', 'Interview Type')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {interviewTypes.map(type => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => {
                    setSelectedType(type.value);
                    if (type.value === 'ai') setProposedSlots([]);
                  }}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center',
                    selectedType === type.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/30'
                  )}
                >
                  <type.icon className={cn('w-6 h-6', selectedType === type.value ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="text-xs font-medium">{t(type.labelKey, type.value)}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{t(type.descKey, '')}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Time Slot Picker for physical/online */}
          {needsScheduling && (
            <TimeSlotPicker
              slots={proposedSlots}
              onChange={setProposedSlots}
              maxSlots={5}
            />
          )}

          <div className="space-y-1.5">
            <Label>{t('interview.notes', 'Notes (optional)')}</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t('interview.notes_placeholder', 'Reason for re-interview...')}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button className="gradient-primary border-0" onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            {t('interview.send_request', 'Send Request')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
