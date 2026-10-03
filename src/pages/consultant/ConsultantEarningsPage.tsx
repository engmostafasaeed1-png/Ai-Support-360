import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DollarSign, ArrowDownToLine, Wallet, Receipt, Clock,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { format } from 'date-fns';
import ShareMenu from '@/components/ShareMenu';
import PayoutDetailsCard from '@/components/consultant/PayoutDetailsCard';

const paymentStatusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  completed: 'default',
  pending: 'secondary',
  refunded: 'destructive',
  disputed: 'destructive',
};

const paymentStatusLabel: Record<string, string> = {
  completed: 'Paid by the client',
  pending: 'Awaiting the client\'s payment',
  refunded: 'Refunded',
  disputed: 'Disputed',
};

const payoutStatusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  completed: 'default',
  processing: 'secondary',
  pending: 'outline',
  failed: 'destructive',
};

const payoutStatusLabel: Record<string, string> = {
  completed: 'Paid to your bank',
  processing: 'Being prepared',
  pending: 'Waiting for the administrator',
  failed: 'Problem',
};

const money = (n: number, currency = 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
};

export default function ConsultantEarningsPage() {
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ['consultant-earnings'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: consultant } = await supabase
        .from('consultants')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!consultant) return null;

      // Invoices made out for this consultant's work
      const { data: payments } = await supabase
        .from('payments')
        .select('*')
        .eq('consultant_id', consultant.id)
        .order('created_at', { ascending: false });

      // Payouts: what the platform transfers to the consultant (after its commission)
      const { data: payouts } = await supabase
        .from('payouts')
        .select('*')
        .eq('consultant_id', consultant.id)
        .order('created_at', { ascending: false });

      // Client names
      const clientIds = [...new Set((payments || []).map(p => p.client_id))];
      let clientMap: Record<string, string> = {};
      if (clientIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profile_directory')
          .select('user_id, display_name')
          .in('user_id', clientIds);
        if (profiles) {
          clientMap = Object.fromEntries(profiles.map(p => [p.user_id, p.display_name || 'Client']));
        }
      }

      const allPayments = (payments || []).map(p => ({
        ...p,
        client_name: clientMap[p.client_id] || 'Client',
      }));
      const allPayouts: any[] = payouts || [];
      const currency = (allPayouts[0]?.currency as string) || (allPayments[0]?.currency as string) || 'USD';

      const sum = (rows: any[], pick: (r: any) => number) => rows.reduce((s, r) => s + pick(r), 0);
      const totalEarned = sum(allPayouts.filter(p => p.status !== 'failed'), p => Number(p.amount));
      const awaitingClient = sum(allPayments.filter((p: any) => p.status === 'pending'), (p: any) => Number(p.amount) - Number(p.vat_amount || 0));
      const inProgress = sum(allPayouts.filter(p => p.status === 'pending' || p.status === 'processing'), p => Number(p.amount));
      const paidOut = sum(allPayouts.filter(p => p.status === 'completed'), p => Number(p.amount));

      // Monthly breakdown of what was earned (after commission)
      const monthlyMap: Record<string, number> = {};
      allPayouts
        .filter(p => p.status !== 'failed')
        .forEach(p => {
          const m = format(new Date(p.created_at), 'MMM');
          monthlyMap[m] = (monthlyMap[m] || 0) + Number(p.amount);
        });
      const monthlyTrend = Object.entries(monthlyMap).map(([month, amount]) => ({ month, amount }));

      return {
        payments: allPayments,
        payouts: allPayouts,
        currency,
        totalEarned,
        awaitingClient,
        inProgress,
        paidOut,
        monthlyTrend,
      };
    },
  });

  const e = data || {
    payments: [] as any[], payouts: [] as any[], currency: 'USD', totalEarned: 0, awaitingClient: 0, inProgress: 0, paidOut: 0,
    monthlyTrend: [] as { month: string; amount: number }[],
  };

  const kpis = [
    { label: 'Earned (after commission)', value: money(e.totalEarned, e.currency), icon: DollarSign, color: 'bg-accent/10 text-accent' },
    { label: 'Invoices awaiting the client', value: money(e.awaitingClient, e.currency), icon: Clock, color: 'bg-yellow-100 text-yellow-600' },
    { label: 'Payout in progress', value: money(e.inProgress, e.currency), icon: Receipt, color: 'bg-purple-100 text-purple-600' },
    { label: 'Paid to your bank', value: money(e.paidOut, e.currency), icon: Wallet, color: 'bg-green-100 text-green-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('earnings.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            When a client's payment is confirmed, the platform keeps its commission and transfers the rest to your bank account.
            Add your bank details in the "Bank details" tab.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ShareMenu
            title={t('earnings.title')}
            text="Earnings Report"
            details={[
              { label: 'Earned (after commission)', value: money(e.totalEarned, e.currency) },
              { label: 'Awaiting the client', value: money(e.awaitingClient, e.currency) },
              { label: 'Payout in progress', value: money(e.inProgress, e.currency) },
              { label: 'Paid to your bank', value: money(e.paidOut, e.currency) },
            ]}
            variant="outline"
            size="sm"
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k, i) => (
          <Card key={i} className="rounded-2xl border-border/50">
            <CardContent className="p-5">
              <div className={`w-10 h-10 rounded-xl ${k.color} flex items-center justify-center mb-3`}>
                <k.icon className="w-5 h-5" />
              </div>
              {isLoading ? <Skeleton className="h-8 w-24" /> : (
                <div className="text-2xl font-bold text-foreground">{k.value}</div>
              )}
              <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Monthly Chart */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">{t('earnings.monthly_trend')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={e.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(value: number) => [money(value, e.currency), t('earnings.amount')]}
                contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', fontSize: '12px' }}
              />
              <Bar dataKey="amount" fill="hsl(217, 91%, 60%)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Tabs: Invoices, Payouts, Bank details */}
      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList className="bg-muted/50 rounded-xl p-1">
          <TabsTrigger value="payments" className="rounded-lg text-sm">{t('earnings.payment_history')}</TabsTrigger>
          <TabsTrigger value="payouts" className="rounded-lg text-sm">{t('earnings.payout_history')}</TabsTrigger>
          <TabsTrigger value="bank" className="rounded-lg text-sm">Bank details</TabsTrigger>
        </TabsList>

        <TabsContent value="payments">
          <Card className="rounded-2xl border-border/50">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}
                </div>
              ) : e.payments.length === 0 ? (
                <div className="p-12 text-center">
                  <Receipt className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">{t('earnings.no_payments')}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('earnings.client')}</TableHead>
                      <TableHead>{t('earnings.date')}</TableHead>
                      <TableHead>{t('earnings.invoice')}</TableHead>
                      <TableHead className="text-end">Invoice (without VAT)</TableHead>
                      <TableHead className="text-end">{t('earnings.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {e.payments.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.client_name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {format(new Date(p.created_at), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {p.invoice_number || '—'}
                        </TableCell>
                        <TableCell className="text-end font-semibold text-foreground">
                          {money(Number(p.amount) - Number(p.vat_amount || 0), p.currency || e.currency)}
                        </TableCell>
                        <TableCell className="text-end">
                          <Badge variant={paymentStatusVariant[p.status] || 'outline'} className="text-[10px]">
                            {paymentStatusLabel[p.status] || p.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payouts">
          <Card className="rounded-2xl border-border/50">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 space-y-3">
                  {[1, 2].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}
                </div>
              ) : e.payouts.length === 0 ? (
                <div className="p-12 text-center">
                  <ArrowDownToLine className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">{t('earnings.no_payouts')}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('earnings.date')}</TableHead>
                      <TableHead>Bank reference</TableHead>
                      <TableHead className="text-end">Invoice (without VAT)</TableHead>
                      <TableHead className="text-end">Platform commission</TableHead>
                      <TableHead className="text-end">You receive</TableHead>
                      <TableHead className="text-end">{t('earnings.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {e.payouts.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-muted-foreground text-sm">
                          {format(new Date(p.created_at), 'MMM d, yyyy')}
                          {p.paid_at && <div className="text-xs">paid {format(new Date(p.paid_at), 'MMM d, yyyy')}</div>}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm font-mono">
                          {p.bank_reference || '—'}
                        </TableCell>
                        <TableCell className="text-end text-sm">
                          {p.gross_amount != null ? money(Number(p.gross_amount), p.currency) : '—'}
                        </TableCell>
                        <TableCell className="text-end text-sm text-muted-foreground">
                          {p.commission_amount != null ? `${money(Number(p.commission_amount), p.currency)} (${p.commission_percent}%)` : '—'}
                        </TableCell>
                        <TableCell className="text-end font-semibold text-foreground">
                          {money(Number(p.amount), p.currency)}
                        </TableCell>
                        <TableCell className="text-end">
                          <Badge variant={payoutStatusVariant[p.status] || 'outline'} className="text-[10px]">
                            {payoutStatusLabel[p.status] || p.status}
                          </Badge>
                          {p.status === 'failed' && p.note && <div className="text-xs text-destructive mt-1 max-w-[220px] ms-auto">{p.note}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bank">
          <PayoutDetailsCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
