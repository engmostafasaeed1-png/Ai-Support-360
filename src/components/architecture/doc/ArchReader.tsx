import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import BrdComments from '@/components/brd/BrdComments';
import { downloadAttachedArch, getArchVersion, logArchAccess, type ArchState } from '@/lib/architecture/api';
import { archPdfBlob } from '@/lib/architecture/pdf';
import { archFileName, normalizeArchContent, type ArchContent } from '../../../../supabase/functions/_shared/archModel';
import ArchSectionView from './ArchSectionView';
import { archCommentApi, metaOf, refOf } from './archShared';

/** Read-only view for assigned consultants (shared documents) and company members: saved versions only, comments allowed. */
export default function ArchReader({ state, onReload }: { state: ArchState; onReload: () => void }) {
  const { t } = useTranslation();
  const doc = state.doc!;
  const versions = state.versions ?? [];
  const [version, setVersion] = useState<number>(versions[0]?.version ?? 0);
  const [content, setContent] = useState<ArchContent | null>(null);
  const [busy, setBusy] = useState(false);
  const canSuggest = state.role === 'consultant' || state.role === 'company';

  useEffect(() => {
    if (!version) return;
    let live = true;
    setContent(null);
    void getArchVersion(doc.id, version).then((r) => {
      if (!live) return;
      if (r.error || !r.data) { toast.error(r.error?.message ?? t('arch.common.failed')); return; }
      setContent(normalizeArchContent(r.data.content, doc.type));
    });
    return () => { live = false; };
  }, [doc.id, doc.type, version, t]);

  const pdf = async () => {
    if (!content) return;
    setBusy(true);
    try {
      const att = (state.attachments ?? []).find((a) => a.version === version && !a.unattached_at);
      if (att) { const e = await downloadAttachedArch(doc.id, att); if (e) toast.error(e); return; }
      const log = await logArchAccess(doc.id, version, 'download');
      if (log.error) { toast.error(log.error.message); return; }
      const blob = await archPdfBlob(content, { ref: refOf(state), meta: metaOf(state), version, versions, systems: (state.systems ?? []).filter((s) => content.systems.includes(s.id!)) }, state.assets ?? []);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = archFileName(doc.type, refOf(state), version);
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { toast.error(t('arch.common.failed')); } finally { setBusy(false); }
  };

  if (!versions.length) return <p className="text-sm text-muted-foreground">{t('arch.reader.noVersion')}</p>;
  const dir = content?.language === 'ar' ? 'rtl' : 'ltr';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground me-auto"><Lock className="h-3.5 w-3.5" aria-hidden />{t('arch.reader.readOnly')}</p>
        <Select value={String(version)} onValueChange={(v) => setVersion(Number(v))}>
          <SelectTrigger className="h-8 w-48" aria-label={t('arch.versions.version')}><SelectValue /></SelectTrigger>
          <SelectContent>{versions.map((v) => <SelectItem key={v.version} value={String(v.version)}>v{v.version} · {t(`arch.status.${v.status}`)}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy || !content} onClick={() => void pdf()}><Download className="h-3.5 w-3.5" />{t('arch.editor.pdf')}</Button>
      </div>
      {!content ? <Skeleton className="h-96 rounded-2xl" /> : (
        <ArchSectionView content={content} assets={state.assets ?? []} renderAfter={(key) => (
          <BrdComments ticketId="" version={version} section={key} comments={state.comments ?? []} canSuggest={canSuggest} canDecide={false}
            onChanged={onReload} dir={dir} api={archCommentApi(doc.id)} />
        )} />
      )}
    </div>
  );
}
