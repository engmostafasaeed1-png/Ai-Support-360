import { useState } from 'react';
import { AlertTriangle, Download, ExternalLink, Library, Loader2, RefreshCw, Square, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useDocImport, useSapDocSources, useSetDocSourceEnabled } from '@/hooks/useSapDocs';
import {
  DOC_ACTION_LABEL, DOC_SIZE_HINT, DOC_STATUS_LABEL, describeSource, importPercent, primaryAction, repoUrl, type SapDocSource,
} from '@/lib/sapDocsAdmin';

const STATUS_CLASS: Record<SapDocSource['status'], string> = {
  empty: 'bg-muted text-muted-foreground',
  importing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ready: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

/** The administrator imports parts of SAP's open documentation (CC BY 4.0) and switches them on for the suggestions. */
export default function SapDocsCard() {
  const sources = useSapDocSources();
  const setEnabled = useSetDocSourceEnabled();
  const importer = useDocImport();
  const [removing, setRemoving] = useState<SapDocSource | null>(null);
  const list = sources.data ?? [];

  return (
    <Card className="rounded-2xl border-border/50" data-testid="sap-docs-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Library className="h-4 w-4 text-accent" /> SAP open documentation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          SAP publishes parts of its documentation as open text on GitHub under the CC BY 4.0 licence. Import the parts you want, switch them on, and the suggestions can use them as one more source.
          Every suggestion that uses a page shows the page, SAP SE as the author, the licence, and that the text was shortened and reworded. Nothing is imported until you press Import.
        </p>

        {sources.isLoading ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : sources.error ? (
          <p className="text-sm text-destructive">Could not load the sources.</p>
        ) : (
          <div className="space-y-2">
            {list.map((s) => {
              const working = importer.busy === s.id;
              const action = primaryAction(s.status);
              const link = repoUrl(s.repo);
              return (
                <div key={s.id} className="space-y-2 rounded-xl border border-border/50 p-3" data-testid={`sap-doc-${s.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{s.title}</p>
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                          {s.repo} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                      {DOC_SIZE_HINT[s.id] && <p className="text-[11px] text-muted-foreground">{DOC_SIZE_HINT[s.id]}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={`text-[10px] ${STATUS_CLASS[s.status]}`}>{DOC_STATUS_LABEL[s.status]}</Badge>
                      <Switch
                        checked={s.enabled}
                        disabled={s.status !== 'ready' || setEnabled.isPending || working}
                        aria-label={`Use ${s.title} in suggestions`}
                        onCheckedChange={(value) => setEnabled.mutate({ id: s.id, enabled: value })}
                      />
                    </div>
                  </div>

                  {s.status === 'importing' && (
                    <div className="space-y-1">
                      <Progress value={importPercent(s)} className="h-2" />
                      <p className="text-[11px] text-muted-foreground">
                        {s.files_done.toLocaleString('en-US')} of {s.files_total.toLocaleString('en-US')} pages read
                        {!working && ' (the import is paused: press Continue)'}
                      </p>
                    </div>
                  )}
                  {s.status === 'ready' && <p className="text-[11px] text-muted-foreground">{describeSource(s)}</p>}
                  {s.last_error && (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {s.last_error}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {working ? (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={importer.stopping} onClick={importer.cancel}>
                        {importer.stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                        {importer.stopping ? 'Stopping...' : 'Stop'}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant={action === 'update' ? 'outline' : 'default'}
                        className="h-8 gap-1.5 text-xs"
                        disabled={!!importer.busy}
                        onClick={() => void importer.run(s.id, action === 'continue' ? 'continue' : 'import')}
                      >
                        {action === 'update' ? <RefreshCw className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                        {DOC_ACTION_LABEL[action]}
                      </Button>
                    )}
                    {s.status !== 'empty' && (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={!!importer.busy} onClick={() => setRemoving(s)}>
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </Button>
                    )}
                    {action === 'update' && !working && (
                      <span className="text-[11px] text-muted-foreground">Update replaces the stored text with the current version from GitHub.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              The imported text of this source is deleted from your database and the suggestions stop using it. You can import it again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = removing?.id;
                setRemoving(null);
                if (id) void importer.remove(id);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
