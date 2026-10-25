import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useArchDoc } from '@/hooks/useArchitecture';
import { updateArchMeta } from '@/lib/architecture/api';
import { TYPE_TITLES, LIMITS } from '../../../supabase/functions/_shared/archModel';
import ArchStatusBadge from '@/components/architecture/ArchStatusBadge';
import ArchEditor from '@/components/architecture/doc/ArchEditor';
import ArchReader from '@/components/architecture/doc/ArchReader';
import { refOf } from '@/components/architecture/doc/archShared';

/** One architecture document: editor for the owning company's writers / admins, read-only view for everyone else allowed. */
export default function ArchDocumentPage({ back }: { back: string }) {
  const { docId } = useParams();
  const { t, i18n } = useTranslation();
  const ar = i18n.language?.startsWith('ar');
  const { data, isLoading, refetch } = useArchDoc(docId);
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const reload = () => { void refetch(); };

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-12 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>;
  const state = data?.state;
  if (!state?.doc) {
    return (
      <div className="max-w-xl mx-auto text-center space-y-3 py-12">
        <p className="font-medium">{data?.notReady ? t('arch.unavailable.notReady') : t('arch.doc.notFound')}</p>
        <Button asChild variant="outline"><Link to={back}>{t('arch.common.back')}</Link></Button>
      </div>
    );
  }
  const doc = state.doc;
  const editor = state.role === 'client' || state.role === 'admin';
  const saveTitle = async () => {
    if (!editTitle?.trim()) { setEditTitle(null); return; }
    const r = await updateArchMeta(doc.id, { title: editTitle.trim() });
    if (r.error) toast.error(r.error.message); else { setEditTitle(null); reload(); }
  };

  return (
    <div className="space-y-4">
      <Link to={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('arch.title')}</Link>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px]">{TYPE_TITLES[doc.type][ar ? 'ar' : 'en']}</Badge>
          <ArchStatusBadge status={doc.status} />
          <span className="text-xs font-mono text-muted-foreground">{refOf(state)}{doc.latest_version ? ` · v${doc.latest_version}` : ''}</span>
          {doc.confidentiality === 'shared' && <Badge variant="secondary" className="text-[10px]">{t('arch.conf.sharedShort')}</Badge>}
        </div>
        {editTitle !== null ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void saveTitle(); }}>
            <Input autoFocus value={editTitle} maxLength={LIMITS.title} onChange={(e) => setEditTitle(e.target.value)} aria-label={t('arch.fields.title')} />
            <Button type="submit" size="sm">{t('arch.common.save')}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditTitle(null)}>{t('common.cancel', 'Cancel')}</Button>
          </form>
        ) : (
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {doc.title}
            {state.can_write && <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t('arch.doc.rename')} onClick={() => setEditTitle(doc.title)}><Pencil className="h-3.5 w-3.5" /></Button>}
          </h1>
        )}
        <p className="text-sm text-muted-foreground">
          {[doc.sap_area, doc.sap_module, doc.sap_version].filter(Boolean).join(' · ') || t('arch.doc.noArea')}
          {doc.owner_name && ` · ${t('arch.fields.owner')}: ${doc.owner_name}`}
        </p>
        {doc.status === 'archived' && <p role="note" className="rounded-xl bg-muted p-2 text-sm">{t('arch.doc.archived')}</p>}
        {!state.enabled && editor && state.role !== 'admin' && <p role="note" className="rounded-xl bg-muted p-2 text-sm">{t('arch.unavailable.off')}</p>}
      </header>
      {editor && doc.draft ? <ArchEditor key={doc.id} state={state} onReload={reload} /> : <ArchReader state={state} onReload={reload} />}
    </div>
  );
}
