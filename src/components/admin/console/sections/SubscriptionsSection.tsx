import { CreditCard } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useSubscriptionPlans } from '@/hooks/useSubscriptionPlans';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

export default function SubscriptionsSection() {
  const { data: plans, isLoading } = useSubscriptionPlans();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" /> Subscriptions & Plans
        </h2>
        <p className="text-sm text-muted-foreground">Manage subscription plans and pricing</p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
        </div>
      ) : plans && plans.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan: any) => (
            <Card key={plan.id} className="rounded-2xl">
              <CardContent className="pt-6 text-center space-y-3">
                <Badge variant="outline" className="text-xs">{plan.name}</Badge>
                <p className="text-3xl font-bold text-foreground">
                  ${plan.price_monthly}<span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
                <p className="text-xs text-muted-foreground">{plan.description || 'No description'}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="rounded-2xl">
          <CardContent className="py-12 text-center text-muted-foreground">
            No subscription plans configured yet.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
