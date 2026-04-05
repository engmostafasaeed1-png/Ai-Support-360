import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';

interface NDAStatsCardsProps {
  total: number;
  drawn: number;
  active: number;
  revoked: number;
}

export default function NDAStatsCards({ total, drawn, active, revoked }: NDAStatsCardsProps) {
  const { t } = useTranslation();

  const stats = [
    { value: total, label: t('admin.nda_total', 'Total NDAs Signed'), color: 'text-foreground' },
    { value: drawn, label: t('admin.nda_drawn', 'Drawn Signatures'), color: 'text-foreground' },
    { value: active, label: t('admin.nda_active', 'Active NDAs'), color: 'text-foreground' },
    { value: revoked, label: t('admin.nda_revoked_count', 'Revoked NDAs'), color: 'text-destructive' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
      {stats.map((s, i) => (
        <Card key={i} className="rounded-2xl">
          <CardContent className="p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
