import { useTranslation } from 'react-i18next';
import { BookOpen, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const articles = [
  { id: '1', title: 'Getting Started with SAP S/4HANA', module: 'S/4HANA', views: 234 },
  { id: '2', title: 'SAP FI Month-End Closing Checklist', module: 'FI', views: 189 },
  { id: '3', title: 'Common SAP MM Issues & Solutions', module: 'MM', views: 156 },
  { id: '4', title: 'SAP Basis Performance Tuning Guide', module: 'Basis', views: 98 },
];

export default function KnowledgePage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('sidebar.knowledge', 'Knowledge Base')}</h1>
        <p className="text-muted-foreground text-sm">Browse articles and guides</p>
      </div>
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search articles..." className="ps-9" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {articles.map((a) => (
          <Card key={a.id} className="border-border/40 hover:border-primary/30 transition-colors cursor-pointer">
            <CardContent className="p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <BookOpen className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm">{a.title}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="text-[10px]">{a.module}</Badge>
                  <span className="text-xs text-muted-foreground">{a.views} views</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
