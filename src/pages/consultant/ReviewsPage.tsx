import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const reviews = [
  { id: '1', client: 'Acme Corp', score: 5, comment: 'Excellent SAP FI expertise. Resolved our issue quickly.', date: '2026-03-20' },
  { id: '2', client: 'Tech Solutions', score: 4, comment: 'Very knowledgeable consultant. Good communication.', date: '2026-03-15' },
  { id: '3', client: 'Global Industries', score: 5, comment: 'Outstanding support during our S/4HANA migration.', date: '2026-03-10' },
];

export default function ReviewsPage() {
  const { t } = useTranslation();
  const avg = (reviews.reduce((s, r) => s + r.score, 0) / reviews.length).toFixed(1);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('sidebar.reviews', 'Reviews')}</h1>
        <p className="text-muted-foreground text-sm">Average rating: {avg} / 5 ({reviews.length} reviews)</p>
      </div>
      <div className="space-y-3">
        {reviews.map((r) => (
          <Card key={r.id} className="border-border/40">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">{r.client}</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className={`w-4 h-4 ${i < r.score ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground/30'}`} />
                  ))}
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{r.comment}</p>
              <p className="text-xs text-muted-foreground mt-2">{r.date}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
