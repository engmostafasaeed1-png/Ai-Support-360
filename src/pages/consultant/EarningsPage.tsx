import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DollarSign, ArrowDownToLine, TrendingUp, Wallet, Receipt, Clock,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line,
} from 'recharts';
import { format } from 'date-fns';
import { mockEarnings } from '@/data/consultantMockData';
import PayoutModal from '@/components/consultant/PayoutModal';

const paymentStatusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  completed: 'default',
  pending: 'secondary',
  refunded: 'destructive',
  disputed: 'destructive',
};

const payoutStatusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  completed: 'default',
  processing: 'secondary',
  pending: 'outline',
  failed: 'destructive',
};

export default function EarningsPage() {
  const { t } = useTranslation();
  const [payoutOpen, setPayoutOpen] = useState(false);

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

      // Payments
      const { data: payments } = await supabase
        .from('payments')
        .select('*')
        .eq('consultant_id', consultant.id)
        .order('created_at', { ascending: false });

      // Payouts
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
          .from('profiles')
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

      const totalEarned = allPayments
        .filter(p => p.status === 'completed')
        .reduce((s, p) => s + Number(p.amount), 0);
      const pending = allPayments
        .filter(p => p.status === 'pending')
        .reduce((s, p) => s + Number(p.amount), 0);
      const totalPaidOut = (payouts || [])
        .filter(p => p.status === 'completed')
        .reduce((s, p) => s + Number(p.amount), 0);

      // Monthly breakdown from payments
      const monthlyMap: Record<string, number> = {};
      allPayments
        .filter(p => p.status === 'completed')
        .forEach(p => {
          const m = format(new Date(p.created_at), 'MMM');
          monthlyMap[m] = (monthlyMap[m] || 0) + Number(p.amount);
        });
      const monthlyTrend = Object.entries(monthlyMap).map(([month, amount]) => ({ month, amount }));

      return {
        payments: allPayments,
        payouts: payouts || [],
        totalEarned,
        pending,
        available: totalEarned - totalPaidOut,
        monthlyTrend: monthlyTrend.length > 0 ? monthlyTrend : mockEarnings.monthlyTrend,
      };
    },
  });

  const e = data || { payments: [], payouts: [], totalEarned: mockEarnings.total, pending: mockEarnings.pending, available: mockEarnings.available, monthlyTrend: mockEarnings.monthlyTrend };

  const kpis = [
    { labelKey: 'earnings.total_earned', value: `$${e.totalEarned.toLocaleString()}`, icon: DollarSign, color: 'bg-accent/10 text-accent' },
    { labelKey: 'earnings.pending', value: `$${e.pending.toLocaleString()}`, icon: Clock, color: 'bg-yellow-100 text-yellow-600' },
    { labelKey: 'earnings.available', value: `$${e.available.toLocaleString()}`, icon: Wallet, color: 'bg-green-100 text-green-600' },
    { labelKey: 'earnings.transactions', value: e.payments.length.toString(), icon: Receipt, color: 'bg-purple-100 text-purple-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('earnings.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('earnings.subtitle')}</p>
        </div>
        <Button className="gradient-primary border-0" size="sm" onClick={() => setPayoutOpen(true)}>
          <ArrowDownToLine className="w-4 h-4 me-1" /> {t('earnings.request_payout')}
        </Button>
      </div>

      <PayoutModal
        open={payoutOpen}
        onOpenChange={setPayoutOpen}
        available={e.available}
        consultantId={data?.payments?.[0]?.consultant_id ?? null}
      />

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
              <div className="text-xs text-muted-foreground mt-1">{t(k.labelKey)}</div>
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
              <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
              <Tooltip
                formatter={(value: number) => [`$${value.toLocaleString()}`, t('earnings.amount')]}
                contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', fontSize: '12px' }}
              />
              <Bar dataKey="amount" fill="hsl(217, 91%, 60%)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Tabs: Payments & Payouts */}
      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList className="bg-muted/50 rounded-xl p-1">
          <TabsTrigger value="payments" className="rounded-lg text-sm">{t('earnings.payment_history')}</TabsTrigger>
          <TabsTrigger value="payouts" className="rounded-lg text-sm">{t('earnings.payout_history')}</TabsTrigger>
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
                      <TableHead className="text-end">{t('earnings.amount')}</TableHead>
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
                        <TableCell className="text-end font-semibold text-green-600">
                          +${Number(p.amount).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-end">
                          <Badge variant={paymentStatusVariant[p.status] || 'outline'} className="text-[10px]">
                            {t(`earnings.ps_${p.status}`)}
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
                      <TableHead>{t('earnings.method')}</TableHead>
                      <TableHead>{t('earnings.reference')}</TableHead>
                      <TableHead className="text-end">{t('earnings.amount')}</TableHead>
                      <TableHead className="text-end">{t('earnings.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {e.payouts.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-muted-foreground text-sm">
                          {format(new Date(p.created_at), 'MMM d, yyyy')}
                        </TableCell>
                        <TableCell className="font-medium capitalize">
                          {p.payout_method || '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {p.reference || '—'}
                        </TableCell>
                        <TableCell className="text-end font-semibold text-foreground">
                          ${Number(p.amount).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-end">
                          <Badge variant={payoutStatusVariant[p.status] || 'outline'} className="text-[10px]">
                            {t(`earnings.po_${p.status}`)}
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
      </Tabs>
    </div>
  );
}
