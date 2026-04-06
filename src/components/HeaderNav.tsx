import { useTranslation } from 'react-i18next';
import { NavLink } from '@/components/NavLink';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Briefcase, Calendar, MessageSquare, CreditCard,
  Star, User, ShieldCheck, BookOpen, Bell, Settings, TicketPlus,
  Users, FileText, Plug, Kanban, UserCheck, BarChart3, Monitor,
  ScrollText, Crown, Shield, Activity, Workflow, ClipboardList,
  Building2,
} from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

const clientNavItems: NavItem[] = [
  { label: 'Dashboard', path: '/client', icon: LayoutDashboard },
  { label: 'New Request', path: '/client/new-request', icon: TicketPlus },
  { label: 'Tickets', path: '/client/tickets', icon: Briefcase },
  { label: 'Consultants', path: '/client/consultants', icon: Users },
  { label: 'Sessions', path: '/client/sessions', icon: Calendar },
  { label: 'Payments', path: '/client/payments', icon: CreditCard },
  { label: 'Chat', path: '/client/chat', icon: MessageSquare },
  { label: 'Integrations', path: '/client/integrations', icon: Plug },
  { label: 'Company', path: '/client/company', icon: Building2 },
  { label: 'Remote Access', path: '/client/remote-access', icon: Monitor },
  { label: 'Settings', path: '/client/settings', icon: Settings },
];

const consultantNavItems: NavItem[] = [
  { label: 'Dashboard', path: '/consultant', icon: LayoutDashboard },
  { label: 'Cases', path: '/consultant/cases', icon: Briefcase },
  { label: 'Calendar', path: '/consultant/calendar', icon: Calendar },
  { label: 'Chat', path: '/consultant/chat', icon: MessageSquare },
  { label: 'Earnings', path: '/consultant/earnings', icon: CreditCard },
  { label: 'Profile', path: '/consultant/profile', icon: User },
  { label: 'Verification', path: '/consultant/verification', icon: ShieldCheck },
  { label: 'Remote Access', path: '/consultant/remote-access', icon: Monitor },
];

const adminNavItems: NavItem[] = [
  { label: 'Dashboard', path: '/admin', icon: LayoutDashboard },
  { label: 'Users', path: '/admin/users', icon: Users },
  { label: 'Tickets', path: '/admin/tickets', icon: Kanban },
  { label: 'Approvals', path: '/admin/approvals', icon: UserCheck },
  { label: 'Analytics', path: '/admin/analytics', icon: BarChart3 },
  { label: 'Environments', path: '/admin/environments', icon: Monitor },
  { label: 'Env Logs', path: '/admin/environment-logs', icon: ScrollText },
  { label: 'NDA', path: '/admin/nda-management', icon: FileText },
  { label: 'Integrations', path: '/admin/integrations', icon: Plug },
  { label: 'Settings', path: '/admin/settings', icon: Settings },
];

const superAdminNavItems: NavItem[] = [
  { label: 'Overview', path: '/super-admin', icon: LayoutDashboard },
  { label: 'Roles', path: '/super-admin/roles', icon: Shield },
  { label: 'Users', path: '/super-admin/users', icon: Users },
  { label: 'Reports', path: '/super-admin/reports', icon: BarChart3 },
  { label: 'Config', path: '/super-admin/config', icon: Settings },
  { label: 'Workflows', path: '/super-admin/workflows', icon: Workflow },
  { label: 'Audit Logs', path: '/super-admin/audit', icon: ClipboardList },
  { label: 'System Health', path: '/super-admin/system', icon: Activity },
];

const navMap: Record<string, NavItem[]> = {
  client: clientNavItems,
  consultant: consultantNavItems,
  admin: adminNavItems,
  'super-admin': superAdminNavItems,
};

interface HeaderNavProps {
  role: 'client' | 'consultant' | 'admin' | 'super-admin';
}

export default function HeaderNav({ role }: HeaderNavProps) {
  const items = navMap[role] || [];

  return (
    <ScrollArea className="w-full">
      <nav className="flex items-center gap-0.5 px-1 py-1">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === `/${role}` || item.path === '/super-admin'}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all shrink-0"
            activeClassName="bg-primary/10 text-primary shadow-sm"
          >
            <item.icon className="w-3.5 h-3.5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <ScrollBar orientation="horizontal" className="h-1" />
    </ScrollArea>
  );
}
