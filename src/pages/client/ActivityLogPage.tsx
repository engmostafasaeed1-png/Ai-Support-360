import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, Ticket, Users, CreditCard, Settings, FileText, CheckCircle } from 'lucide-react';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { Skeleton } from '@/components/ui/skeleton';

const typeIcons: Record<string, typeof Activity> = {
  ticket: Ticket,
  calendar: Users,
  match: Users,
  payment: CreditCard,
  resolved: CheckCircle,
  settings: Settings,
  document: FileText,
};

const typeColors: Record<string, string> = {
  ticket: 'bg-primary/10 text-primary',
  calendar: 'bg-blue-500/10 text-blue-600',
  match: 'bg-violet-500/10 text-violet-600',
  payment: 'bg-emerald-500/10 text-emerald-600',
  resolved: 'bg-green-500/10 text-green-600',
  settings: 'bg-muted text-muted-foreground',
  document: 'bg-amber-500/10 text-amber-600',
};

export default function ActivityLogPage() {
  const { t } = useTranslation();
  const { data: activities = [], isLoading } = useActivityFeed();

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('sidebar.activity_log', 'Activity Log')}</h1>
        <p className="text-sm text-muted-foreground mt-1">Timeline of all actions across your company</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}
            </div>
          ) : activities.length === 0 ? (
            <div className="py-12 text-center">
              <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Nothing here yet</p>
              <p className="text-xs text-muted-foreground mt-1">Your recent actions will appear here.</p>
            </div>
          ) : (
            <ScrollArea className="h-[60vh]">
              <div className="divide-y divide-border">
                {activities.map((activity: any) => {
                  const Icon = typeIcons[activity.icon] || Activity;
                  const colorClass = typeColors[activity.icon] || 'bg-muted text-muted-foreground';
                  return (
                    <div key={activity.id} className="flex items-start gap-3 px-6 py-4 hover:bg-muted/30 transition-colors">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${colorClass}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{activity.message}</p>
                      </div>
                      <div className="text-end shrink-0">
                        <Badge variant="outline" className="text-[10px] font-normal capitalize">{activity.type}</Badge>
                        <p className="text-[10px] text-muted-foreground mt-1">{activity.time}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
