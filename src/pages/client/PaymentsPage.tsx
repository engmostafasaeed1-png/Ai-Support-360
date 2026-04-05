import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useClientPayments } from '@/hooks/useClientPayments';
import { Download, CreditCard, DollarSign, FileText, Clock } from 'lucide-react';

export default function PaymentsPage() {
  const { data: payments, isLoading } = useClientPayments();

  const allPayments = payments || [];
  const total = allPayments.reduce((a, p) => a + Number(p.amount), 0);
  const pending = allPayments.filter((p) => p.status === 'pending').reduce((a, p) => a + Number(p.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Payments & Invoices</h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">View payment history and download invoices.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Spent', value: `$${total.toLocaleString()}`, icon: DollarSign, color: 'bg-accent/10 text-accent' },
          { label: 'Pending', value: `$${pending.toLocaleString()}`, icon: Clock, color: 'bg-yellow-100 text-yellow-600' },
          { label: 'Invoices', value: allPayments.length.toString(), icon: FileText, color: 'bg-purple-100 text-purple-600' },
          { label: 'Payment Method', value: 'Visa •••• 4242', icon: CreditCard, color: 'bg-green-100 text-green-600' },
        ].map((k, i) => (
          <Card key={i} className="rounded-2xl border-border/50">
            <CardContent className="p-5">
              <div className={`w-10 h-10 rounded-xl ${k.color} flex items-center justify-center mb-3`}>
                <k.icon className="w-5 h-5" />
              </div>
              {isLoading ? <Skeleton className="h-7 w-20" /> : (
                <div className="text-xl font-bold text-foreground">{k.value}</div>
              )}
              <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : allPayments.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No payments yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {allPayments.map((payment: any) => (
                <div key={payment.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-muted/20 border border-border/30">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-accent" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{payment.invoice_number || 'Invoice'}</p>
                      <p className="text-xs text-muted-foreground truncate">{payment.consultant_name || 'Consultant'} · {new Date(payment.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 justify-between sm:justify-end">
                    <div className="text-start sm:text-end">
                      <p className="text-sm font-bold text-foreground">${Number(payment.amount).toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">VAT: ${Number(payment.vat_amount || 0).toLocaleString()}</p>
                    </div>
                    <Badge variant="secondary" className={`text-[10px] ${payment.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {payment.status}
                    </Badge>
                    <Button variant="ghost" size="icon" title="Download Invoice" className="shrink-0">
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
