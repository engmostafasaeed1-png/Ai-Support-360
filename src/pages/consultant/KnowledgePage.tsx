import { useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { BookOpenCheck, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import KnowledgeArticleDialog from '@/components/knowledge/KnowledgeArticleDialog';
import { useMyArticles } from '@/hooks/useKnowledgeReview';
import { ARTICLE_STATUS_LABEL } from '@/lib/knowledgeReview';

export default function ConsultantKnowledgePage() {
  const { t } = useTranslation();
  const [writing, setWriting] = useState(false);
  const articles = useMyArticles();
  const list = articles.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('sidebar.knowledge', 'Knowledge Base')}</h1>
          <p className="text-sm text-muted-foreground">
            Write articles that help clients. An administrator reads each one before anyone else sees it.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setWriting(true)}>
          <Pencil className="h-4 w-4" /> Write an article
        </Button>
      </div>

      {articles.isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : articles.error ? (
        <p className="text-sm text-destructive">Could not load your articles.</p>
      ) : list.length === 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            You have not written an article yet. Use "Write an article" to share a fix or a checklist. Describe it in your own words and, if you like, name the SAP Notes that belong to it by number.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((a) => (
            <Card key={a.id} className="rounded-2xl border-border/50">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <BookOpenCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-semibold">{a.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {a.sap_modules.slice(0, 4).map((m) => <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>)}
                      <span className="text-[11px] text-muted-foreground">{format(new Date(a.created_at), 'MMM d, yyyy')}</span>
                    </div>
                  </div>
                </div>
                <Badge variant={a.status === 'published' ? 'default' : 'secondary'} className="shrink-0">
                  {ARTICLE_STATUS_LABEL[a.status] ?? a.status}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <KnowledgeArticleDialog open={writing} onOpenChange={setWriting} />
    </div>
  );
}
