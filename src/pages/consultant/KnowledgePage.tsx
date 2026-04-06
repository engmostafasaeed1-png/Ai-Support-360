import { useTranslation } from 'react-i18next';
import { BookOpen, Search, PenSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const articles = [
  { id: '1', title: 'SAP FI Best Practices for Month-End', module: 'FI', status: 'published' },
  { id: '2', title: 'Troubleshooting SAP MM Posting Errors', module: 'MM', status: 'draft' },
  { id: '3', title: 'SAP Basis Transport Management Guide', module: 'Basis', status: 'published' },
];

export default function ConsultantKnowledgePage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('sidebar.knowledge', 'Knowledge Base')}</h1>
          <p className="text-muted-foreground text-sm">Your published articles and guides</p>
        </div>
        <Button size="sm" className="gap-1.5"><PenSquare className="w-4 h-4" /> New Article</Button>
      </div>
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search articles..." className="ps-9" />
      </div>
      <div className="space-y-3">
        {articles.map((a) => (
          <Card key={a.id} className="border-border/40 hover:border-primary/30 transition-colors cursor-pointer">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <BookOpen className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{a.title}</p>
                  <Badge variant="secondary" className="text-[10px] mt-1">{a.module}</Badge>
                </div>
              </div>
              <Badge variant={a.status === 'published' ? 'default' : 'secondary'}>{a.status}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
