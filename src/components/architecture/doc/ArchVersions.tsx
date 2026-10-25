import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Eye, GitCompare, RotateCcw, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import BrdDiffView from '@/components/brd/BrdDiffView';
import { getArchVersion, restoreArchVersion, type ArchAsset, type ArchVersionRow } from '@/lib/architecture/api';
import { diffArch, normalizeArchContent, type ArchContent, type ArchMeta, type ArchType } from '../../../../supabase/functions/_shared/archModel';
import ArchStatusBadge from '../ArchStatusBadge';
import ArchSectionView from './ArchSectionView';

/** Immutable versions: view, compare with the previous one, restore (creates a new version, never edits one). */
export default function ArchVersions({ docId, type, versions, assets, canWrite, onRestored }: {
  docId: string; type: ArchType; versions: ArchVersionRow[]; assets: ArchAsset[]; canWrite: boolean; onRestored: (content: ArchContent, rev: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const [view, setView] = useState<{ version: number; content: ArchContent } | null>(null);
  const [diff, setDiff] = useState<{ a: number; b: number; diffs: ReturnType<typeof diffArch> } | null>(null);
  const [restore, setRestore] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const when = (s: string) => new Date(s).toLocaleString(ar ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const load = async (v: number) => {
    const r = await getArchVersion(docId, v);
    if (r.error || !r.data) { toast.error(r.error?.message ?? t('arch.common.failed')); return null; }
    return { content: normalizeArchContent(r.data.content, type), meta: r.data.meta as Partial<ArchMeta> };
  };
  const open = async (v: number) => { const x = await load(v); if (x) setView({ version: v, content: x.content }); };
  const compare = async (v: number) => {
    const [a, b] = await Promise.all([load(v - 1), load(v)]);
    if (a && b) setDiff({ a: v - 1, b: v, diffs: diffArch(a, b, ar ? 'ar' : 'en') });
  };
  const doRestore = async () => {
    if (restore == null) return;
    setBusy(true);
    const r = await restoreArchVersion(docId, restore, note.trim());
    setBusy(false);
    if (r.error || !r.data) { toast.error(r.error?.message ?? t('arch.common.failed')); return; }
    toast.success(t('arch.versions.restored', { from: restore, to: r.data.version }));
    onRestored(normalizeArchContent(r.data.content, type), r.data.rev);
    setRestore(null); setNote('');
  };

  if (!versions.length) return <p className="text-sm text-muted-foreground">{t('arch.versions.none')}</p>;
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {versions.map((v) => (
          <li key={v.version} className="rounded-xl border border-border p-3 text-sm space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">v{v.version}</span>
              <ArchStatusBadge status={v.status} />
              {v.restored_from && <Badge variant="outline" className="text-[10px]">{t('arch.versions.restoredFrom', { v: v.restored_from })}</Badge>}
              {v.attached && <Badge variant="secondary" className="text-[10px] gap-1"><Paperclip className="h-3 w-3" aria-hidden />{t('arch.versions.attached')}</Badge>}
              <span className="text-xs text-muted-foreground ms-auto">{when(v.created_at)} · {v.author}</span>
            </div>
            {v.change_note && <p className="text-xs text-muted-foreground">{v.change_note}</p>}
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => void open(v.version)}><Eye className="h-3.5 w-3.5" />{t('arch.versions.view')}</Button>
              {v.version > 1 && <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => void compare(v.version)}><GitCompare className="h-3.5 w-3.5" />{t('arch.versions.compare')}</Button>}
              {canWrite && <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setRestore(v.version)}><RotateCcw className="h-3.5 w-3.5" />{t('arch.versions.restore')}</Button>}
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('arch.versions.viewTitle', { v: view?.version })}</DialogTitle></DialogHeader>
          {view && <ArchSectionView content={view.content} assets={assets} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!diff} onOpenChange={(o) => !o && setDiff(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('arch.versions.compareTitle', { a: diff?.a, b: diff?.b })}</DialogTitle></DialogHeader>
          {diff && <BrdDiffView diffs={diff.diffs} dir={ar ? 'rtl' : 'ltr'} />}
        </DialogContent>
      </Dialog>
      <Dialog open={restore != null} onOpenChange={(o) => !o && setRestore(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('arch.versions.restoreTitle', { v: restore })}</DialogTitle>
            <DialogDescription>{t('arch.versions.restoreHint')}</DialogDescription>
          </DialogHeader>
          <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t('arch.versions.note')} aria-label={t('arch.versions.note')} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRestore(null)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={doRestore} disabled={busy}>{t('arch.versions.restore')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
