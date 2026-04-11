import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2, FileText, GitBranch, AlertTriangle, PenTool,
  Map, Network, Shield, Users, CalendarDays
} from 'lucide-react';

const timelineEvents = [
  {
    date: '2025-04-08', title: 'Security Architecture Blueprint updated to v0.9',
    type: 'blueprint', author: 'Fatima Hassan', icon: Shield,
    description: 'Added penetration testing plan and GDPR data residency requirements.',
  },
  {
    date: '2025-04-05', title: 'Data Migration Blueprint submitted for review',
    type: 'blueprint', author: 'Omar Khaled', icon: Map,
    description: 'v1.7 includes revised cleansing rules for vendor master data and updated LTMC templates.',
  },
  {
    date: '2025-04-02', title: 'Fiori UX Strategy design document created',
    type: 'design', author: 'Ahmed Al-Rashid', icon: PenTool,
    description: 'Initial draft covering launchpad configuration, custom tile groups, and mobile-first approach.',
  },
  {
    date: '2025-03-28', title: 'S/4HANA Target Architecture approved (v2.3)',
    type: 'milestone', author: 'Ahmed Al-Rashid', icon: CheckCircle2,
    description: 'Final sign-off from CTO and steering committee. Blueprint is now baselined.',
  },
  {
    date: '2025-03-20', title: 'Analytics Architecture decision pending review',
    type: 'design', author: 'Sara Mohammed', icon: PenTool,
    description: 'Proposed hybrid approach (Embedded + BW/4HANA) awaiting BI Lead and Finance Director approval.',
  },
  {
    date: '2025-03-15', title: 'Integration Architecture approved (v3.0)',
    type: 'milestone', author: 'Sara Mohammed', icon: CheckCircle2,
    description: 'CPI-based integration architecture finalized. Development can proceed for Wave 1 interfaces.',
  },
  {
    date: '2025-02-15', title: 'Custom Code Remediation strategy approved',
    type: 'design', author: 'Fatima Hassan', icon: GitBranch,
    description: 'Phased approach with ATC checks selected. 847 custom objects identified for Wave 1.',
  },
  {
    date: '2025-02-05', title: 'Database Deployment decided: Azure Private Cloud',
    type: 'decision', author: 'Omar Khaled', icon: AlertTriangle,
    description: 'Critical decision finalized. Azure East US primary, West EU for DR. EA discount applied.',
  },
  {
    date: '2025-01-22', title: 'Integration Platform selected: SAP BTP Integration Suite',
    type: 'decision', author: 'Sara Mohammed', icon: Network,
    description: 'CPI chosen over MuleSoft and Boomi for native SAP integration and lower TCO.',
  },
  {
    date: '2025-01-10', title: 'Migration approach finalized: Selective Data Transition',
    type: 'decision', author: 'Ahmed Al-Rashid', icon: Map,
    description: 'Hybrid approach chosen. Balances clean start with historical data preservation.',
  },
];

const typeCfg: Record<string, { label: string; color: string }> = {
  blueprint: { label: 'Blueprint', color: 'bg-primary/10 text-primary border-primary/20' },
  design: { label: 'Design Doc', color: 'bg-accent/10 text-accent border-accent/20' },
  milestone: { label: 'Milestone', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200' },
  decision: { label: 'Decision', color: 'bg-amber-500/10 text-amber-600 border-amber-200' },
};

export default function ArchitectureTimeline() {
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Architecture evolution timeline showing key decisions, milestones, and document updates</p>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-[18px] top-0 bottom-0 w-px bg-border" />

        <div className="space-y-4">
          {timelineEvents.map((event, i) => {
            const Icon = event.icon;
            const tc = typeCfg[event.type];
            return (
              <div key={i} className="relative flex gap-4 pl-0">
                {/* Dot */}
                <div className="relative z-10 w-9 h-9 rounded-full bg-background border-2 border-border flex items-center justify-center shrink-0">
                  <Icon className={`w-4 h-4 ${event.type === 'milestone' ? 'text-emerald-500' : event.type === 'decision' ? 'text-amber-500' : 'text-primary'}`} />
                </div>

                <Card className="flex-1 rounded-2xl border-border/50 hover:shadow-premium transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`text-[9px] ${tc.color}`}>{tc.label}</Badge>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" />{event.date}
                          </span>
                        </div>
                        <h4 className="text-sm font-semibold text-foreground">{event.title}</h4>
                        <p className="text-xs text-muted-foreground">{event.description}</p>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Users className="w-3 h-3" />{event.author}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
