import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import {
  Shield, Users, BarChart3, CreditCard, Ticket, UserCheck,
  Lock, Key, Eye, Activity, Bell, Globe, Palette, HardDrive,
  Mail, Server, AlertTriangle, FileText, Kanban, Handshake,
  BookOpen, Settings, Monitor, Layers, ScrollText, Video,
  GraduationCap, CalendarClock
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface AdminSection {
  id: string;
  label: string;
  icon: LucideIcon;
  group: string;
}

export const adminSections: AdminSection[] = [
  // Platform
  { id: 'overview', label: 'Overview & Analytics', icon: BarChart3, group: 'Platform' },
  { id: 'users', label: 'User Management', icon: Users, group: 'Platform' },
  { id: 'roles', label: 'Roles & Permissions', icon: Shield, group: 'Platform' },
  { id: 'subscriptions', label: 'Subscriptions & Plans', icon: CreditCard, group: 'Platform' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, group: 'Platform' },

  // Operations
  { id: 'tickets', label: 'Ticket Management', icon: Kanban, group: 'Operations' },
  { id: 'approvals', label: 'Consultant Approvals', icon: UserCheck, group: 'Operations' },
  { id: 'nda', label: 'NDA Management', icon: FileText, group: 'Operations' },
  { id: 'match-requests', label: 'Match Requests', icon: Handshake, group: 'Operations' },
  { id: 'projects', label: 'Projects & Milestones', icon: Layers, group: 'Operations' },
  { id: 'interview-training', label: 'Interview Training', icon: GraduationCap, group: 'Operations' },
  { id: 'oncall', label: 'On-Call Schedule', icon: CalendarClock, group: 'Operations' },
  { id: 'meeting-events', label: 'Meeting Join Events', icon: Video, group: 'Operations' },

  // Security
  { id: 'security', label: 'Security Settings', icon: Lock, group: 'Security' },
  { id: 'auth', label: 'Authentication', icon: Key, group: 'Security' },
  { id: 'rls', label: 'Data Access Policies', icon: Eye, group: 'Security' },
  { id: 'audit', label: 'Audit Logs', icon: Activity, group: 'Security' },

  // System
  { id: 'notifications', label: 'Notifications', icon: Bell, group: 'System' },
  { id: 'localization', label: 'Localization', icon: Globe, group: 'System' },
  { id: 'appearance', label: 'Appearance & Theme', icon: Palette, group: 'System' },
  { id: 'storage', label: 'File Storage', icon: HardDrive, group: 'System' },
  { id: 'email', label: 'Email Templates', icon: Mail, group: 'System' },
  { id: 'integrations', label: 'Integrations & API', icon: Server, group: 'System' },
  { id: 'environments', label: 'Remote Environments', icon: Monitor, group: 'System' },
  { id: 'vmware', label: 'VMware Settings', icon: HardDrive, group: 'System' },
  { id: 'environment-logs', label: 'Environment Logs', icon: ScrollText, group: 'System' },
  { id: 'landing', label: 'Landing Page Editor', icon: BookOpen, group: 'System' },
  { id: 'settings', label: 'Platform Settings', icon: Settings, group: 'System' },
  { id: 'maintenance', label: 'Maintenance Mode', icon: AlertTriangle, group: 'System' },
];

const groups = ['Platform', 'Operations', 'Security', 'System'];

interface AdminConsoleSidebarProps {
  activeSection: string;
  onSelect: (id: string) => void;
}

export default function AdminConsoleSidebar({ activeSection, onSelect }: AdminConsoleSidebarProps) {
  return (
    <ScrollArea className="h-[calc(100vh-7rem)] pr-2">
      <div className="space-y-6 py-2">
        {groups.map((group) => (
          <div key={group}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-3">
              {group}
            </p>
            <div className="space-y-0.5">
              {adminSections
                .filter((s) => s.group === group)
                .map((section) => {
                  const Icon = section.icon;
                  return (
                    <button
                      key={section.id}
                      onClick={() => onSelect(section.id)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                        activeSection === section.id
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{section.label}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
