import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Eye, GitCompare, RotateCcw, Archive, Share2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { archiveBrdVersion, getBrdVersion, restoreBrdVersion, type BrdState } from '@/lib/brd/api';
import BrdDocumentView from './BrdDocumentView';
import BrdDiffView from './BrdDiffView';
import { diffContents } from '../../../supabase/functions/_shared/brdDiff';
import { normalizeContent, type BrdContent } from '../../../supabase/functions/_shared/brdModel';
import { useBrdApproval } from '@/hooks/useBrdApproval';
import { roundForVersion } from '@/lib/brdApproval';
import { BrdApprovalChip } from './approval/BrdApprovalChip';

interface Props {
  state: BrdState;
  canWrite: boolean;
  isAdmin: boolean;
  onRestored: (content: BrdContent, rev: number) => void;
  onChanged: () => void;
  onAttach: (version: number) => void;
}

const fmt = (iso: string, lang: string) => new Date(iso).toLocaleString(lang.startsWith('ar') ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** Version list: view, compare any two (side by side per section), restore as a new version, admin soft-archive. */
export default function BrdVersionsPanel({ state, canWrite, isAdmin, onRestored, onChanged, onAttach }: Props) {
  const { t, i18n } = useTranslation();
  const ticketId = state.ticket!.id;
  const { data: approval } = useBrdApproval(ticketId);
  const versions = state.versions ?? [];
  const [picked, setPicked] = useState<number[]>([]);
  const [view, setView] = useState<{ version: number; content: BrdContent } | null>(null);
  const [compare, setCompare] = useState<{ a: number; b: number; diffs: ReturnType<typeof diffContents>; dir: 'ltr' | 'rtl' } | null>(null);
  const [busy, setBusy] = useState(false);
  const meta = versions.map((v) => ({ ...v }));

  const load = async (n: number) => {
    const r = await getBrdVersion(ticketId, n);
    if (r.error || !r.data) { toast.error(r.error?.message ?? t('brd.err.load')); return null; }
    return normalizeContent(r.data.content);
  };

  const doCompare = async () => {
    const [a, b] = [...picked].sort((x, y) => x - y);
    setBusy(true);
    const [ca, cb] = await Promise.all([load(a), load(b)]);
    setBusy(false);
    if (!ca || !cb) return;
    const lang = cb.language === 'ar' ? 'ar' : 'en';
    setCompare({ a, b, diffs: diffContents(ca, cb, lang), dir: lang === 'ar' ? 'rtl' : 'ltr' });
  };

  if (versions.length === 0) return <p className="text-sm text-muted-foreground">{t('brd.versions.none')}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground flex-1">{t('brd.versions.pickTwo')}</p>
        <Button size="sm" variant="outline" className="gap-1.5" busy={busy} reason={picked.length !== 2 && 'choose_two_versions'} onClick={doCompare}>
          <GitCompare className="h-4 w-4" /> {t('brd.versions.compare')}
        </Button>
      </div>
      <ul className="space-y-2">
        {versions.map((v) => (
          <li key={v.version} className={`rounded-xl border p-3 flex flex-wrap items-center gap-3 ${v.archived_at ? 'opacity-60 border-dashed' : 'border-border'}`}>
            <Checkbox aria-label={t('brd.versions.pick', { v: v.version })} checked={picked.includes(v.version)}
              onCheckedChange={(on) => setPicked((p) => on === true ? [...p.filter((x) => x !== v.version), v.version].slice(-2) : p.filter((x) => x !== v.version))} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">v{v.version}</span>
                <Badge variant={v.status === 'final' ? 'default' : 'secondary'} className="text-[10px]">{t(`brd.status.${v.status}`)}</Badge>
                {state.brd?.shared_version === v.version && <Badge className="text-[10px] bg-success text-success-foreground">{t('brd.versions.shared')}</Badge>}
                {v.attached && state.brd?.shared_version !== v.version && <Badge variant="outline" className="text-[10px]">{t('brd.versions.attachedOld')}</Badge>}
                {v.restored_from && <Badge variant="outline" className="text-[10px]">{t('brd.versions.restoredFrom', { v: v.restored_from })}</Badge>}
                {v.archived_at && <Badge variant="outline" className="text-[10px]">{t('brd.versions.archived')}</Badge>}
                {(() => { const r = roundForVersion(approval?.rounds, v.version); return r ? <BrdApprovalChip state={r.state} prefix={false} /> : null; })()}
              </div>
              <p className="text-xs text-muted-foreground">{v.author} · {fmt(v.created_at, i18n.language)}</p>
              {v.change_note && <p className="text-sm mt-0.5 break-words">{v.change_note}</p>}
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={async () => { const c = await load(v.version); if (c) setView({ version: v.version, content: c }); }}>
                <Eye className="h-4 w-4" /> {t('brd.versions.view')}
              </Button>
              {canWrite && !v.archived_at && (
                <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => onAttach(v.version)}><Share2 className="h-4 w-4" /> {t('brd.attach.short')}</Button>
              )}
              {canWrite && (
                <Button size="sm" variant="ghost" className="h-8 gap-1" busy={busy} onClick={async () => {
                  setBusy(true);
                  const r = await restoreBrdVersion(ticketId, v.version, t('brd.versions.restoreNote', { v: v.version }));
                  setBusy(false);
                  if (r.error || !r.data) { toast.error(r.error?.message ?? t('brd.err.save')); return; }
                  toast.success(t('brd.versions.restored', { v: v.version, n: r.data.version }));
                  onRestored(normalizeContent(r.data.content), r.data.rev);
                }}><RotateCcw className="h-4 w-4" /> {t('brd.versions.restore')}</Button>
              )}
              {isAdmin && !v.archived_at && <ArchiveButton ticketId={ticketId} version={v.version} onDone={onChanged} />}
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>v{view?.version}</DialogTitle></DialogHeader>
          {view && <BrdDocumentView content={view.content} version={view.version} versions={meta} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!compare} onOpenChange={(o) => !o && setCompare(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t('brd.versions.compareTitle', { a: compare?.a, b: compare?.b })}</DialogTitle></DialogHeader>
          {compare && <BrdDiffView diffs={compare.diffs} dir={compare.dir} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArchiveButton({ ticketId, version, onDone }: { ticketId: string; version: number; onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <>
      <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => setOpen(true)}><Archive className="h-4 w-4" /> {t('brd.versions.archive')}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('brd.versions.archiveTitle', { v: version })}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('brd.versions.archiveHint')}</p>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label={t('brd.reason')} placeholder={t('brd.reason')} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button reason={reason.trim().length < 3 && { key: 'reason_required', params: { min: 3 } }} onClick={async () => {
              const r = await archiveBrdVersion(ticketId, version, reason);
              if (r.error) { toast.error(r.error.message); return; }
              setOpen(false); onDone();
            }}>{t('brd.versions.archive')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
