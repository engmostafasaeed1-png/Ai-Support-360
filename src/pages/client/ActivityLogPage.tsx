import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, Ticket, Users, CreditCard, Settings, FileText } from 'lucide-react';

const mockActivities = [
  { id: '1', action: 'Ticket Created', entity: 'SAP FI Configuration Issue', type: 'ticket', user: 'You', time: '2 hours ago' },
  { id: '2', action: 'Consultant Assigned', entity: 'MM Module Optimization', type: 'assignment', user: 'System', time: '5 hours ago' },
  { id: '3', action: 'Payment Completed', entity: 'Invoice #INV-2024-031', type: 'payment', user: 'You', time: '1 day ago' },
  { id: '4', action: 'Ticket Resolved', entity: 'SD Pricing Error', type: 'ticket', user: 'Ahmad K.', time: '2 days ago' },
  { id: '5', action: 'Team Member Added', entity: 'sara@company.com', type: 'team', user: 'You', time: '3 days ago' },
  { id: '6', action: 'Settings Updated', entity: 'Notification Preferences', type: 'settings', user: 'You', time: '4 days ago' },
  { id: '7', action: 'Document Uploaded', entity: 'SAP_Config_Guide.pdf', type: 'document', user: 'You', time: '5 days ago' },
  { id: '8', action: 'Ticket Created', entity: 'ABAP Custom Report Bug', type: 'ticket', user: 'Sara M.', time: '1 week ago' },
];

const typeIcons: Record<string, typeof Activity> = {
  ticket: Ticket,
  assignment: Users,
  payment: CreditCard,
  team: Users,
  settings: Settings,
  document: FileText,
};

const typeColors: Record<string, string> = {
  ticket: 'bg-primary/10 text-primary',
  assignment: 'bg-blue-500/10 text-blue-600',
  payment: 'bg-emerald-500/10 text-emerald-600',
  team: 'bg-violet-500/10 text-violet-600',
  settings: 'bg-muted text-muted-foreground',
  document: 'bg-amber-500/10 text-amber-600',
};

export default function ActivityLogPage() {
  const { t } = useTranslation();

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
          <ScrollArea className="h-[60vh]">
            <div className="divide-y divide-border">
              {mockActivities.map((activity) => {
                const Icon = typeIcons[activity.type] || Activity;
                const colorClass = typeColors[activity.type] || 'bg-muted text-muted-foreground';
                return (
                  <div key={activity.id} className="flex items-start gap-3 px-6 py-4 hover:bg-muted/30 transition-colors">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${colorClass}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{activity.action}</p>
                      <p className="text-xs text-muted-foreground truncate">{activity.entity}</p>
                    </div>
                    <div className="text-end shrink-0">
                      <Badge variant="outline" className="text-[10px] font-normal">{activity.user}</Badge>
                      <p className="text-[10px] text-muted-foreground mt-1">{activity.time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
