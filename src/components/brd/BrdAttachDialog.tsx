import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { attachBrdPdf, getBrdVersion, notifyBrdByEmail, type BrdState } from '@/lib/brd/api';
import { brdPdfBlob } from '@/lib/brd/pdf';
import { normalizeContent } from '../../../supabase/functions/_shared/brdModel';
import { useBrdApproval, useRefreshBrdApproval } from '@/hooks/useBrdApproval';
import { submitBrdForApproval } from '@/lib/brd/approvalApi';
import { approvalErrorKey } from '@/lib/brdApproval';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  state: BrdState;
  initialVersion: number | null;
  onDone: () => void;
}

/** Publishes a saved version to the ticket's documents as a PDF; the previous one stays listed as superseded. */
export default function BrdAttachDialog({ open, onOpenChange, state, initialVersion, onDone }: Props) {
  const { t } = useTranslation();
  const versions = (state.versions ?? []).filter((v) => !v.archived_at);
  const [version, setVersion] = useState<number | null>(initialVersion);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const { data: approval } = useBrdApproval(state.ticket?.id);
  const refreshApproval = useRefreshBrdApproval(state.ticket?.id);
  const approvalOn = !!approval?.me?.can_submit && approval.settings?.mode !== 'off';
  const [ask, setAsk] = useState(true);
  useEffect(() => { if (open) setVersion(initialVersion ?? versions[0]?.version ?? null); }, [open, initialVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    if (!version) return;
    setBusy(true);
    try {
      const v = await getBrdVersion(state.ticket!.id, version);
      if (v.error || !v.data) throw new Error(v.error?.message ?? 'load');
      const pdf = await brdPdfBlob(normalizeContent(v.data.content), {
        ticketRef: state.ticket!.ref, ticketTitle: state.ticket!.title, version,
        versions: (state.versions ?? []).filter((x) => x.version <= version),
      });
      const r = await attachBrdPdf(state.ticket!.id, version, pdf, notify);
      if (r.error || !r.data) throw new Error(r.error?.message ?? 'attach');
      if (notify && r.data.notified > 0) void notifyBrdByEmail(r.data.document_id);
      toast.success(t('brd.attach.done', { v: version, name: r.data.file_name }));
      if (notify) toast.info(r.data.notified > 0 ? t('brd.attach.notified', { count: r.data.notified }) : t('brd.attach.nobody'));
      if (approvalOn && ask) {
        const a = await submitBrdForApproval(state.ticket!.id, version, false, null);
        if (a.error || !a.data) toast.error(t(approvalErrorKey(a.error?.message)));
        else {
          toast.success(t('brd.approval.asked', { v: version, count: a.data.notified }));
          if (a.data.waiting_access > 0) toast.info(t('brd.approval.waitingAccess', { count: a.data.waiting_access }));
        }
      }
      refreshApproval();
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(t('brd.attach.failed', { reason: e instanceof Error ? e.message : '' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('brd.attach.title')}</DialogTitle>
          <DialogDescription>{t('brd.attach.intro')}</DialogDescription>
        </DialogHeader>
        {versions.length === 0 ? <p className="text-sm text-muted-foreground">{t('brd.attach.needVersion')}</p> : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('brd.attach.version')}</Label>
              <Select value={version ? String(version) : undefined} onValueChange={(v) => setVersion(Number(v))}>
                <SelectTrigger aria-label={t('brd.attach.version')}><SelectValue /></SelectTrigger>
                <SelectContent>{versions.map((v) => <SelectItem key={v.version} value={String(v.version)}>v{v.version} · {t(`brd.status.${v.status}`)}{v.change_note ? ` · ${v.change_note.slice(0, 40)}` : ''}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="brd-notify" checked={notify} onCheckedChange={(v) => setNotify(v === true)} />
              <Label htmlFor="brd-notify" className="font-normal text-sm leading-snug">{t('brd.attach.notify')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">{t('brd.attach.who')}</p>
            {approvalOn && (
              <div className="flex items-start gap-2">
                <Checkbox id="brd-ask-approval" checked={ask} onCheckedChange={(v) => setAsk(v === true)} />
                <Label htmlFor="brd-ask-approval" className="font-normal text-sm leading-snug">
                  {t('brd.approval.attachAsk')}
                  <span className="block text-xs text-muted-foreground">{t(`brd.approval.modeHint.${approval?.settings?.mode ?? 'recommended'}`)}</span>
                </Label>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button disabled={busy || !version} onClick={go} className="gap-1.5">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('brd.attach.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
