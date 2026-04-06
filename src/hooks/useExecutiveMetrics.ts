import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface ExecutiveMetrics {
  totalTenants: number;
  activeTenants: number;
  totalUsers: number;
  activeUsersLast30: number;
  mrr: number;
  arr: number;
  growthRate: number;
  churnRate: number;
  openTickets: number;
  resolvedTicketsLast30: number;
  avgResolutionHours: number;
  tierBreakdown: { tier: string; count: number }[];
  revenueByMonth: { month: string; revenue: number; tenants: number }[];
  ticketTrend: { month: string; opened: number; resolved: number }[];
}

export function useExecutiveMetrics() {
  return useQuery({
    queryKey: ['executive-metrics'],
    queryFn: async (): Promise<ExecutiveMetrics> => {
      // Fetch all data in parallel
      const [
        tenantsRes,
        membersRes,
        ticketsRes,
        paymentsRes,
      ] = await Promise.all([
        supabase.from('tenants').select('id, subscription_tier, subscription_status, created_at'),
        supabase.from('tenant_members').select('id, user_id, tenant_id, created_at'),
        supabase.from('tickets' as any).select('id, status, created_at, resolved_at'),
        supabase.from('payments').select('id, amount, currency, status, created_at'),
      ]);

      const tenants = tenantsRes.data || [];
      const members = membersRes.data || [];
      const tickets = (ticketsRes.data || []) as any[];
      const payments = paymentsRes.data || [];

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Tenant metrics
      const totalTenants = tenants.length;
      const activeTenants = tenants.filter(t => t.subscription_status === 'active').length;

      // User metrics
      const uniqueUsers = new Set(members.map(m => m.user_id));
      const totalUsers = uniqueUsers.size;
      const recentMembers = members.filter(m => new Date(m.created_at) >= thirtyDaysAgo);
      const activeUsersLast30 = new Set(recentMembers.map(m => m.user_id)).size;

      // Revenue - MRR calculation based on tier pricing
      const tierPricing: Record<string, number> = { basic: 49, professional: 149, enterprise: 499 };
      const mrr = tenants
        .filter(t => t.subscription_status === 'active')
        .reduce((sum, t) => sum + (tierPricing[t.subscription_tier] || 0), 0);
      const arr = mrr * 12;

      // Growth rate (tenants this month vs last month)
      const thisMonth = tenants.filter(t => {
        const d = new Date(t.created_at);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      }).length;
      const lastMonth = tenants.filter(t => {
        const d = new Date(t.created_at);
        const lm = new Date(now.getFullYear(), now.getMonth() - 1);
        return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
      }).length;
      const growthRate = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : thisMonth > 0 ? 100 : 0;

      // Churn
      const canceledRecent = tenants.filter(t => t.subscription_status === 'canceled').length;
      const churnRate = totalTenants > 0 ? (canceledRecent / totalTenants) * 100 : 0;

      // Tickets
      const openTickets = tickets.filter(t => t.status !== 'resolved' && t.status !== 'closed').length;
      const resolvedLast30 = tickets.filter(t => {
        if (!t.resolved_at) return false;
        return new Date(t.resolved_at) >= thirtyDaysAgo;
      });
      const resolvedTicketsLast30 = resolvedLast30.length;

      // Avg resolution (mock since we may not have resolved_at data yet)
      const avgResolutionHours = resolvedLast30.length > 0
        ? resolvedLast30.reduce((sum, t) => {
            const created = new Date(t.created_at).getTime();
            const resolved = new Date(t.resolved_at).getTime();
            return sum + (resolved - created) / (1000 * 60 * 60);
          }, 0) / resolvedLast30.length
        : 0;

      // Tier breakdown
      const tierCounts: Record<string, number> = {};
      tenants.forEach(t => {
        tierCounts[t.subscription_tier] = (tierCounts[t.subscription_tier] || 0) + 1;
      });
      const tierBreakdown = Object.entries(tierCounts).map(([tier, count]) => ({ tier, count }));

      // Revenue by month (last 6 months)
      const revenueByMonth: { month: string; revenue: number; tenants: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStr = d.toLocaleDateString('en', { month: 'short', year: '2-digit' });
        const tenantsInMonth = tenants.filter(t => {
          const cd = new Date(t.created_at);
          return cd <= new Date(d.getFullYear(), d.getMonth() + 1, 0);
        });
        const rev = tenantsInMonth
          .filter(t => t.subscription_status === 'active')
          .reduce((s, t) => s + (tierPricing[t.subscription_tier] || 0), 0);
        revenueByMonth.push({ month: monthStr, revenue: rev, tenants: tenantsInMonth.length });
      }

      // Ticket trend (last 6 months)
      const ticketTrend: { month: string; opened: number; resolved: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStr = d.toLocaleDateString('en', { month: 'short', year: '2-digit' });
        const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const opened = tickets.filter(t => {
          const cd = new Date(t.created_at);
          return cd >= d && cd <= monthEnd;
        }).length;
        const resolved = tickets.filter(t => {
          if (!t.resolved_at) return false;
          const rd = new Date(t.resolved_at);
          return rd >= d && rd <= monthEnd;
        }).length;
        ticketTrend.push({ month: monthStr, opened, resolved });
      }

      return {
        totalTenants,
        activeTenants,
        totalUsers,
        activeUsersLast30,
        mrr,
        arr,
        growthRate,
        churnRate,
        openTickets,
        resolvedTicketsLast30,
        avgResolutionHours,
        tierBreakdown,
        revenueByMonth,
        ticketTrend,
      };
    },
    refetchInterval: 60000, // refresh every minute
  });
}
