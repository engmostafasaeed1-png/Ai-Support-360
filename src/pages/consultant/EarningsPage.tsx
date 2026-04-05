import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { mockEarnings } from '@/data/consultantMockData';
import { DollarSign, ArrowDownToLine, TrendingUp, Wallet } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from 'recharts';

export default function EarningsPage() {
  const e = mockEarnings;

  const kpis = [
    { label: 'Total Earned', value: `$${e.total.toLocaleString()}`, icon: DollarSign, color: 'bg-accent/10 text-accent' },
    { label: 'This Month', value: `$${e.thisMonth.toLocaleString()}`, icon: TrendingUp, color: 'bg-green-100 text-green-600' },
    { label: 'Pending', value: `$${e.pending.toLocaleString()}`, icon: Wallet, color: 'bg-yellow-100 text-yellow-600' },
    { label: 'Available for Withdrawal', value: `$${e.available.toLocaleString()}`, icon: ArrowDownToLine, color: 'bg-purple-100 text-purple-600' },
  ];

  const transactions = [
    { id: 1, client: 'Saudi Petrochemical Corp', type: 'Session Payment', amount: 450, date: '2026-04-03', status: 'completed' },
    { id: 2, client: 'GCC Retail Group', type: 'Session Payment', amount: 300, date: '2026-04-01', status: 'completed' },
    { id: 3, client: 'Riyadh National Bank', type: 'Session Payment', amount: 600, date: '2026-03-28', status: 'pending' },
    { id: 4, client: 'Al-Faisal Industries', type: 'Session Payment', amount: 375, date: '2026-03-25', status: 'completed' },
    { id: 5, client: 'Payout', type: 'Withdrawal', amount: -2500, date: '2026-03-20', status: 'completed' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Earnings</h1>
          <p className="text-sm text-muted-foreground mt-1">Track your revenue and manage payouts.</p>
        </div>
        <Button className="gradient-primary border-0" size="sm">
          <ArrowDownToLine className="w-4 h-4 me-1" /> Request Payout
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k, i) => (
          <Card key={i} className="rounded-2xl border-border/50">
            <CardContent className="p-5">
              <div className={`w-10 h-10 rounded-xl ${k.color} flex items-center justify-center mb-3`}>
                <k.icon className="w-5 h-5" />
              </div>
              <div className="text-2xl font-bold text-foreground">{k.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Monthly Earnings Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={e.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
              <Tooltip
                formatter={(value: number) => [`$${value.toLocaleString()}`, 'Earnings']}
                contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', fontSize: '12px' }}
              />
              <Line type="monotone" dataKey="amount" stroke="hsl(217, 91%, 60%)" strokeWidth={2.5} dot={{ fill: 'hsl(217, 91%, 60%)', r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Recent Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {transactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 border border-border/30">
                <div>
                  <p className="text-sm font-medium text-foreground">{tx.client}</p>
                  <p className="text-xs text-muted-foreground">{tx.type} · {new Date(tx.date).toLocaleDateString()}</p>
                </div>
                <div className="text-end">
                  <p className={`text-sm font-bold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {tx.amount >= 0 ? '+' : ''}{tx.amount < 0 ? `-$${Math.abs(tx.amount).toLocaleString()}` : `$${tx.amount.toLocaleString()}`}
                  </p>
                  <p className={`text-xs ${tx.status === 'pending' ? 'text-yellow-600' : 'text-muted-foreground'}`}>{tx.status}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
