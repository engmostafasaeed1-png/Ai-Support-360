import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileSignature, Download, Eye, Calendar, DollarSign, User } from 'lucide-react';

const contracts = [
  {
    id: '1',
    title: 'SAP S/4HANA Migration Agreement',
    consultant: 'Ahmed Al-Rashid',
    type: 'Fixed Price',
    value: '$45,000',
    startDate: '2025-01-15',
    endDate: '2025-06-30',
    status: 'active',
    signedDate: '2025-01-10',
  },
  {
    id: '2',
    title: 'BW/4HANA Consulting Services',
    consultant: 'Sara Mohammed',
    type: 'Time & Material',
    value: '$120/hr',
    startDate: '2025-03-01',
    endDate: '2025-08-15',
    status: 'pending_signature',
    signedDate: null,
  },
  {
    id: '3',
    title: 'SuccessFactors Implementation',
    consultant: 'Omar Khaled',
    type: 'Fixed Price',
    value: '$28,500',
    startDate: '2024-09-01',
    endDate: '2025-01-10',
    status: 'completed',
    signedDate: '2024-08-25',
  },
  {
    id: '4',
    title: 'NDA — SAP Fiori Redesign',
    consultant: 'Multiple',
    type: 'NDA',
    value: '—',
    startDate: '2025-02-01',
    endDate: '2026-02-01',
    status: 'active',
    signedDate: '2025-01-28',
  },
];

const statusConfig: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200' },
  pending_signature: { label: 'Pending Signature', color: 'bg-amber-500/10 text-amber-600 border-amber-200' },
  completed: { label: 'Completed', color: 'bg-muted text-muted-foreground border-border' },
  expired: { label: 'Expired', color: 'bg-destructive/10 text-destructive border-destructive/20' },
};

const stats = [
  { label: 'Active Contracts', value: '2', color: 'text-emerald-500' },
  { label: 'Pending Signature', value: '1', color: 'text-amber-500' },
  { label: 'Total Value', value: '$73,500', color: 'text-primary' },
  { label: 'Expired', value: '0', color: 'text-muted-foreground' },
];

export default function ContractsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSignature className="w-6 h-6 text-primary" />
            {t('sidebar.contracts', 'Contracts & Agreements')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">View and manage your contracts with consultants</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="rounded-2xl border-border/50">
            <CardContent className="pt-5 pb-4 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4">
        {contracts.map((contract) => {
          const sc = statusConfig[contract.status];
          return (
            <Card key={contract.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
              <CardContent className="p-5">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <FileSignature className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-foreground">{contract.title}</h3>
                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {contract.consultant}</span>
                          <span className="flex items-center gap-1"><DollarSign className="w-3.5 h-3.5" /> {contract.value}</span>
                          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {contract.startDate} → {contract.endDate}</span>
                        </div>
                      </div>
                      <Badge variant="outline" className={`shrink-0 text-[10px] ${sc.color}`}>{sc.label}</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Badge variant="secondary" className="text-[10px]">{contract.type}</Badge>
                      {contract.signedDate && (
                        <span className="text-[10px] text-muted-foreground">Signed {contract.signedDate}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" className="gap-1 text-xs">
                      <Eye className="w-3.5 h-3.5" /> View
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1 text-xs">
                      <Download className="w-3.5 h-3.5" /> PDF
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
