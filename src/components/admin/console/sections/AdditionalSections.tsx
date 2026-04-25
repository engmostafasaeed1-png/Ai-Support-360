import { BarChart3, HardDrive, ScrollText, Video, GraduationCap, CalendarClock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

function SectionShell({ icon: Icon, title, description, children }: { icon: any; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" /> {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function LinkCard({ to, label }: { to: string; label: string }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="pt-6 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Button asChild size="sm" variant="outline">
          <Link to={to}>Open full page</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function AnalyticsConsoleSection() {
  return (
    <SectionShell icon={BarChart3} title="Analytics" description="Platform-wide analytics and KPIs">
      <LinkCard to="/admin/analytics" label="View detailed analytics dashboard" />
    </SectionShell>
  );
}

export function VMwareSettingsConsoleSection() {
  return (
    <SectionShell icon={HardDrive} title="VMware Settings" description="Hypervisor and virtualization defaults">
      <LinkCard to="/admin/vmware-settings" label="Open VMware configuration" />
    </SectionShell>
  );
}

export function EnvironmentLogsConsoleSection() {
  return (
    <SectionShell icon={ScrollText} title="Environment Logs" description="Audit trail for remote environment activity">
      <LinkCard to="/admin/environment-logs" label="View environment access logs" />
    </SectionShell>
  );
}

export function MeetingEventsConsoleSection() {
  return (
    <SectionShell icon={Video} title="Meeting Join Events" description="Export meeting attendance and join events">
      <LinkCard to="/admin/meeting-join-events" label="Export meeting events" />
    </SectionShell>
  );
}

export function InterviewTrainingConsoleSection() {
  return (
    <SectionShell icon={GraduationCap} title="Interview Training" description="Manage AI interview question banks and training data">
      <LinkCard to="/admin/interview-training" label="Open interview training" />
    </SectionShell>
  );
}

export function OnCallScheduleConsoleSection() {
  return (
    <SectionShell icon={CalendarClock} title="On-Call Schedule" description="Manage on-call rotations and escalation policies">
      <LinkCard to="/admin/oncall" label="Manage on-call schedule" />
    </SectionShell>
  );
}
