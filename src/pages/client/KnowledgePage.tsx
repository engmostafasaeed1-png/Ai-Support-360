import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { BookOpen, Search, Lightbulb, ThumbsUp, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ReactMarkdown from 'react-markdown';

export default function KnowledgePage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<any>(null);

  const { data: articles = [] } = useQuery({
    queryKey: ['knowledge-articles-published'],
    queryFn: async () => {
      const { data } = await supabase
        .from('knowledge_articles')
        .select('*')
        .eq('status', 'published')
        .order('views_count', { ascending: false });
      return data || [];
    },
  });

  const { data: solutions = [] } = useQuery({
    queryKey: ['knowledge-solutions-published'],
    queryFn: async () => {
      const { data } = await supabase
        .from('knowledge_solutions')
        .select('*')
        .eq('status', 'published')
        .order('views_count', { ascending: false });
      return data || [];
    },
  });

  const filteredArticles = articles.filter((a: any) =>
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    (a.sap_module || '').toLowerCase().includes(search.toLowerCase())
  );

  const filteredSolutions = solutions.filter((s: any) =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    (s.sap_module || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.tags || []).some((t: string) => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('sidebar.knowledge', 'Knowledge Base')}</h1>
        <p className="text-muted-foreground text-sm">Browse articles, guides, and AI-generated solutions</p>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search articles & solutions..." className="ps-9" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <Tabs defaultValue="solutions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="solutions" className="gap-1.5"><Lightbulb className="w-3.5 h-3.5" /> Solutions ({filteredSolutions.length})</TabsTrigger>
          <TabsTrigger value="articles" className="gap-1.5"><BookOpen className="w-3.5 h-3.5" /> Articles ({filteredArticles.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="solutions">
          {filteredSolutions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No solutions found. They'll appear here as sessions are analyzed.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredSolutions.map((s: any) => (
                <Card key={s.id} className="border-border/40 hover:border-primary/30 transition-colors cursor-pointer" onClick={() => setSelectedArticle(s)}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Lightbulb className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm line-clamp-2">{s.title}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {s.sap_module && <Badge variant="secondary" className="text-[10px]">{s.sap_module}</Badge>}
                          {(s.tags || []).slice(0, 2).map((tag: string) => (
                            <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                          ))}
                        </div>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{s.views_count}</span>
                          <span className="flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{s.helpful_count}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="articles">
          {filteredArticles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No articles found.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredArticles.map((a: any) => (
                <Card key={a.id} className="border-border/40 hover:border-primary/30 transition-colors cursor-pointer" onClick={() => setSelectedArticle(a)}>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <BookOpen className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">{a.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {a.sap_module && <Badge variant="secondary" className="text-[10px]">{a.sap_module}</Badge>}
                        <span className="text-xs text-muted-foreground">{a.views_count} views</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <Dialog open={!!selectedArticle} onOpenChange={() => setSelectedArticle(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedArticle?.title}</DialogTitle>
          </DialogHeader>
          {selectedArticle?.problem_description && (
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 p-4">
              <p className="text-xs font-semibold text-destructive uppercase mb-1">Problem</p>
              <p className="text-sm">{selectedArticle.problem_description}</p>
            </div>
          )}
          {selectedArticle?.solution && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-4">
              <p className="text-xs font-semibold text-primary uppercase mb-1">Solution</p>
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown>{selectedArticle.solution}</ReactMarkdown>
              </div>
            </div>
          )}
          {selectedArticle?.content && (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown>{selectedArticle.content}</ReactMarkdown>
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            {selectedArticle?.sap_module && <Badge>{selectedArticle.sap_module}</Badge>}
            {(selectedArticle?.tags || []).map((t: string) => <Badge key={t} variant="outline">{t}</Badge>)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
