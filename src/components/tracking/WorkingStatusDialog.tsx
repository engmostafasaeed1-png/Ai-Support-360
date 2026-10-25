import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSetWorkingStatus } from '@/hooks/useTicketTracking';
import {
  RESPONSIBLES, noteRequired, statusDef, statusLabel, validateChange,
  type TrackingSettings, type ViewerRole, type WorkingRow,
} from '@/lib/ticketTracking';
import { ICON, STATUS_ICONS } from './trackingStyles';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticketId: string;
  ticketStatus: string;
  role: ViewerRole;
  allowed: string[];
  settings: TrackingSettings;
  current: WorkingRow | null;
  preset?: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Change the working status: controlled list (admin matrix), note (mandatory for some), expected date, who acts. */
export default function WorkingStatusDialog({ open, onOpenChange, ticketId, ticketStatus, role, allowed, settings, current, preset }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const save = useSetWorkingStatus(ticketId);
  const [key, setKey] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [resp, setResp] = useState('none');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const start = preset && allowed.includes(preset) ? preset : allowed.includes(current?.key ?? '') ? current!.key : allowed[0] ?? '';
    setKey(start);
    setNote(start === current?.key ? current?.note ?? '' : '');
    setDate(start === current?.key ? current?.expected_date ?? '' : '');
    setResp(start === current?.key ? current?.responsible ?? 'none' : 'none');
    setProblem(null);
  }, [open, preset, allowed, current]);

  const required = key ? noteRequired(key, settings) : false;
  const submit = async () => {
    const p = validateChange({
      role, ticketStatus, current: current ? { key: current.key, note: current.note, expected_date: current.expected_date, responsible: current.responsible } : null,
      key, note, expectedDate: date || null, responsible: resp === 'none' ? null : resp, today: today(),
    }, settings);
    if (p) { setProblem(p); return; }
    try {
      await save.mutateAsync({ status: key, note: note.trim(), expectedDate: date || null, responsible: resp === 'none' ? null : resp, version: current?.version ?? null });
      toast.success(t('tracking.saved'));
      onOpenChange(false);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === '40001') { toast.error(t('tracking.err.conflict')); onOpenChange(false); return; }
      if (err.code === '54000') { toast.error(t('tracking.err.rate')); return; }
      toast.error(err.message || t('tracking.err.generic'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('tracking.dialog.title')}</DialogTitle>
          <DialogDescription>{t('tracking.dialog.desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tt-status">{t('tracking.dialog.status')}</Label>
            <Select value={key} onValueChange={(v) => { setKey(v); setProblem(null); }}>
              <SelectTrigger id="tt-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowed.map((k) => {
                  const d = statusDef(settings, k);
                  const Icon = STATUS_ICONS[d?.icon ?? 'circle'];
                  return (
                    <SelectItem key={k} value={k}>
                      <span className="inline-flex items-center gap-2"><Icon className={`h-3.5 w-3.5 ${ICON[d?.color ?? 'muted']}`} aria-hidden />{statusLabel(settings, k, lang)}</span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {key === 'completed' && role === 'consultant' && <p className="text-xs text-muted-foreground">{t('tracking.dialog.completedHint')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tt-note">{t('tracking.dialog.note')} {required ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">({t('tracking.dialog.optional')})</span>}</Label>
            <Textarea id="tt-note" value={note} maxLength={settings.note_max} rows={3} onChange={(e) => { setNote(e.target.value); setProblem(null); }}
              aria-describedby="tt-note-help" aria-required={required} />
            <p id="tt-note-help" className="text-[11px] text-muted-foreground">{t('tracking.dialog.noteHelp')} · {note.trim().length}/{settings.note_max}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tt-date">{t('tracking.dialog.expected')}</Label>
              <Input id="tt-date" type="date" min={today()} value={date} onChange={(e) => { setDate(e.target.value); setProblem(null); }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tt-resp">{t('tracking.dialog.responsible')}</Label>
              <Select value={resp} onValueChange={setResp}>
                <SelectTrigger id="tt-resp"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('tracking.resp.none')}</SelectItem>
                  {RESPONSIBLES.map((r) => <SelectItem key={r} value={r}>{t(`tracking.resp.${r}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {problem && <p className="text-sm text-destructive" role="alert">{t(`tracking.err.${problem}`)}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('tracking.dialog.cancel')}</Button>
          <Button onClick={submit} busy={save.isPending} reason={!key && 'choose_option_first'}>{save.isPending ? t('tracking.dialog.saving') : t('tracking.dialog.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
