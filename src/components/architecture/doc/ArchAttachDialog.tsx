import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { attachArchPdf, getArchVersion, type ArchState } from '@/lib/architecture/api';
import { archPdfBlob } from '@/lib/architecture/pdf';
import { normalizeArchContent } from '../../../../supabase/functions/_shared/archModel';
import { metaOf, refOf } from './archShared';

/** Same flow as the BRD: pick a saved version and a linked ticket; the PDF becomes a ticket document. */
export default function ArchAttachDialog({ state, open, onOpenChange, onDone }: { state: ArchState; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { t } = useTranslation();
  const doc = state.doc!;
  const [ticket, setTicket] = useState(doc.links[0]?.ticket_id ?? '');
  const [version, setVersion] = useState(String(doc.latest_version || ''));
  const [notify, setNotify] = useState(doc.confidentiality === 'shared');
  const [busy, setBusy] = useState(false);

  const attach = async () => {
    setBusy(true);
    try {
      const v = await getArchVersion(doc.id, Number(version));
      if (v.error || !v.data) { toast.error(v.error?.message ?? t('arch.common.failed')); return; }
      const content = normalizeArchContent(v.data.content, doc.type);
      const meta = { ...metaOf(state), ...(v.data.meta ?? {}) };
      const pdf = await archPdfBlob(content, { ref: refOf(state), meta, version: Number(version), versions: state.versions ?? [], systems: (state.systems ?? []).filter((s) => content.systems.includes(s.id!)) }, state.assets ?? []);
      const r = await attachArchPdf(doc.id, ticket, Number(version), pdf, notify);
      if (r.error || !r.data) { toast.error(r.error?.message ?? t('arch.common.failed')); return; }
      toast.success(t('arch.attach.done', { name: r.data.file_name, count: r.data.notified }));
      onOpenChange(false);
      onDone();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('arch.attach.title')}</DialogTitle>
          <DialogDescription>{t('arch.attach.hint')}</DialogDescription>
        </DialogHeader>
        {doc.links.length === 0 ? <p className="text-sm text-muted-foreground">{t('arch.attach.noTickets')}</p>
          : !doc.latest_version ? <p className="text-sm text-muted-foreground">{t('arch.attach.noVersion')}</p> : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="att-ticket">{t('arch.attach.ticket')}</Label>
              <Select value={ticket} onValueChange={setTicket}>
                <SelectTrigger id="att-ticket"><SelectValue /></SelectTrigger>
                <SelectContent>{doc.links.map((l) => <SelectItem key={l.ticket_id} value={l.ticket_id}>{l.ref} · {l.title.slice(0, 50)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="att-version">{t('arch.versions.version')}</Label>
              <Select value={version} onValueChange={setVersion}>
                <SelectTrigger id="att-version"><SelectValue /></SelectTrigger>
                <SelectContent>{(state.versions ?? []).map((v) => <SelectItem key={v.version} value={String(v.version)}>v{v.version} · {t(`arch.status.${v.status}`)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={notify} disabled={doc.confidentiality !== 'shared'} onCheckedChange={(v) => setNotify(!!v)} className="mt-0.5" />
              <span>{t('arch.attach.notify')}{doc.confidentiality !== 'shared' && <span className="block text-xs text-muted-foreground">{t('arch.attach.privateNoNotify')}</span>}</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
              <Button onClick={attach} disabled={busy || !ticket || !version}>{busy ? t('arch.attach.working') : t('arch.attach.button')}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
