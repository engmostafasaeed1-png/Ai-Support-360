import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { downloadAttachedBrd, getBrdVersion, type BrdState } from '@/lib/brd/api';
import BrdDocumentView from './BrdDocumentView';
import BrdComments from './BrdComments';
import { normalizeContent, type BrdContent } from '../../../supabase/functions/_shared/brdModel';

/** Read-only view for assigned consultants (and company colleagues): attached versions only, PDF download, comments. */
export default function BrdReader({ state, refresh }: { state: BrdState; refresh: () => void }) {
  const { t, i18n } = useTranslation();
  const versions = state.versions ?? [];
  const ticketId = state.ticket!.id;
  const [version, setVersion] = useState<number | null>(state.brd?.shared_version ?? versions[0]?.version ?? null);
  const [content, setContent] = useState<BrdContent | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!version) return;
    let live = true;
    setLoading(true);
    void getBrdVersion(ticketId, version).then((r) => {
      if (!live) return;
      setLoading(false);
      if (r.error || !r.data) { toast.error(r.error?.message ?? t('brd.err.load')); return; }
      setContent(normalizeContent(r.data.content));
    });
    return () => { live = false; };
  }, [ticketId, version, t]);

  const file = (state.attachments ?? []).find((a) => a.version === version && !a.unattached_at);
  const dir = content?.language === 'ar' ? 'rtl' : 'ltr';
  if (versions.length === 0) {
    return <Card className="rounded-2xl"><CardContent className="p-6 text-sm text-muted-foreground">{t('brd.reader.nothing')}</CardContent></Card>;
  }
  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t('brd.reader.readOnly')}</Badge>
          {state.last_client_update && (
            <span className="text-xs text-muted-foreground me-auto">
              {t('brd.reader.lastUpdate', { when: new Date(state.last_client_update).toLocaleString(i18n.language?.startsWith('ar') ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) })}
            </span>
          )}
          <Select value={version ? String(version) : undefined} onValueChange={(v) => setVersion(Number(v))}>
            <SelectTrigger className="w-44 h-9" aria-label={t('brd.versions.version')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {versions.map((v) => <SelectItem key={v.version} value={String(v.version)}>v{v.version} · {t(`brd.status.${v.status}`)}{state.brd?.shared_version === v.version ? ` · ${t('brd.versions.current')}` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
          {file && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={async () => { const e = await downloadAttachedBrd(ticketId, file); if (e) toast.error(e); else refresh(); }}>
              <Download className="h-4 w-4" /> {t('brd.reader.download')}
            </Button>
          )}
        </CardContent>
      </Card>
      {loading || !content ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> {t('brd.loading')}</p> : (
        <Card className="rounded-2xl border-border/50"><CardContent className="p-4 sm:p-6">
          <BrdDocumentView content={content} version={version} versions={versions}
            renderSectionFooter={(key) => key === 'change_log' ? null : (
              <BrdComments ticketId={ticketId} version={version!} section={key} comments={state.comments ?? []} canSuggest canDecide={false} onChanged={refresh} dir={dir} />
            )} />
        </CardContent></Card>
      )}
    </div>
  );
}
