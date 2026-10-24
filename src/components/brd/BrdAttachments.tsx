import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Unlink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { downloadAttachedBrd, unattachBrd, type BrdAttachmentRow } from '@/lib/brd/api';

/** The PDFs attached to the ticket: current one, superseded ones, unattached ones (owner/admin only see those). */
export default function BrdAttachments({ ticketId, rows, canWrite, onChanged }: { ticketId: string; rows: BrdAttachmentRow[]; canWrite: boolean; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const [target, setTarget] = useState<BrdAttachmentRow | null>(null);
  const [reason, setReason] = useState('');
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t('brd.attach.noneYet')}</p>;
  return (
    <>
      <ul className="space-y-2">
        {rows.map((d) => (
          <li key={d.id} className={`rounded-xl border p-3 flex flex-wrap items-center gap-2 ${d.unattached_at ? 'opacity-60 border-dashed' : 'border-border'}`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium break-all">{d.file_name}</p>
              <p className="text-xs text-muted-foreground">{t('brd.attach.by', { name: d.attached_by, when: new Date(d.attached_at).toLocaleString(i18n.language?.startsWith('ar') ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
            </div>
            {d.unattached_at ? <Badge variant="outline" className="text-[10px]">{t('brd.attach.unattached')}</Badge>
              : d.superseded_at ? <Badge variant="secondary" className="text-[10px]">{t('brd.attach.superseded')}</Badge>
              : <Badge className="text-[10px] bg-success text-success-foreground">{t('brd.attach.current')}</Badge>}
            {!d.unattached_at && (
              <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={async () => { const err = await downloadAttachedBrd(ticketId, d); if (err) toast.error(err); }}>
                <Download className="h-4 w-4" /> PDF
              </Button>
            )}
            {canWrite && !d.unattached_at && (
              <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => { setTarget(d); setReason(''); }}>
                <Unlink className="h-4 w-4" /> {t('brd.attach.unattach')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('brd.attach.unattachTitle')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('brd.attach.unattachHint')}</p>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label={t('brd.reason')} placeholder={t('brd.reasonOptional')} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTarget(null)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={async () => {
              const r = await unattachBrd(target!.id, reason);
              if (r.error) { toast.error(r.error.message); return; }
              setTarget(null); onChanged();
            }}>{t('brd.attach.unattach')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
