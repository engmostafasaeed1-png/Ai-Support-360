import { useTranslation } from 'react-i18next';
import { FileText, Download, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const mockInvoices = [
  { id: 'INV-001', date: '2026-03-15', amount: 1200, currency: 'SAR', status: 'paid' as const, description: 'SAP FI Consultation - March' },
  { id: 'INV-002', date: '2026-03-28', amount: 800, currency: 'SAR', status: 'pending' as const, description: 'SAP MM Support Session' },
  { id: 'INV-003', date: '2026-04-01', amount: 2400, currency: 'SAR', status: 'overdue' as const, description: 'SAP S/4HANA Migration Support' },
];

const statusColors = { paid: 'bg-green-500/10 text-green-600', pending: 'bg-yellow-500/10 text-yellow-600', overdue: 'bg-red-500/10 text-red-600' };

export default function InvoicesPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('sidebar.invoices', 'Invoices')}</h1>
          <p className="text-muted-foreground text-sm">View and download your invoices</p>
        </div>
      </div>
      <div className="space-y-3">
        {mockInvoices.map((inv) => (
          <Card key={inv.id} className="border-border/40">
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{inv.id}</p>
                  <p className="text-xs text-muted-foreground">{inv.description}</p>
                  <p className="text-xs text-muted-foreground">{inv.date}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge className={statusColors[inv.status]}>{inv.status}</Badge>
                <span className="font-bold text-sm">{inv.amount} {inv.currency}</span>
                <Button size="icon" variant="ghost"><Download className="w-4 h-4" /></Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
