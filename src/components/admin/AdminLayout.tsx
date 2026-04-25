import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Outlet } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import PageTransition from '@/components/PageTransition';
import { FixedHeader, FixedSubHeader } from '@/components/layout/FixedHeader';
import { Search, LayoutDashboard, Users, Kanban, UserCheck, BarChart3, Settings, Plug, Shield, Server, ClipboardList, Settings2, FileSignature, PanelTop, Brain, Bell, Download } from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Badge } from '@/components/ui/badge';
import dashboardBgAsset from '@/assets/videos/dashboard-bg.mp4.asset.json';
import HeaderNav from '@/components/HeaderNav';
import logo from '@/assets/logo.png';
import { Link } from 'react-router-dom';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';

const bottomNavItems = [
  { key: 'dashboard', icon: LayoutDashboard, path: '/admin', labelKey: 'sidebar.dashboard' },
  { key: 'users', icon: Users, path: '/admin/users', labelKey: 'sidebar.users' },
  { key: 'tickets', icon: Kanban, path: '/admin/tickets', labelKey: 'sidebar.ticket_board' },
  { key: 'approvals', icon: UserCheck, path: '/admin/approvals', labelKey: 'sidebar.approvals' },
];

const moreNavItems = [
  { key: 'console', icon: Shield, path: '/admin/console', labelKey: 'sidebar.console' },
  { key: 'analytics', icon: BarChart3, path: '/admin/analytics', labelKey: 'sidebar.analytics' },
  { key: 'integrations', icon: Plug, path: '/admin/integrations', labelKey: 'sidebar.integrations' },
  { key: 'environments', icon: Server, path: '/admin/environments', labelKey: 'sidebar.environments' },
  { key: 'environment_logs', icon: ClipboardList, path: '/admin/environment-logs', labelKey: 'sidebar.environment_logs' },
  { key: 'meeting_join_export', icon: Download, path: '/admin/meeting-join-events', labelKey: 'sidebar.meeting_join_export' },
  { key: 'vmware_settings', icon: Settings2, path: '/admin/vmware-settings', labelKey: 'sidebar.vmware_settings' },
  { key: 'nda_management', icon: FileSignature, path: '/admin/nda-management', labelKey: 'sidebar.nda_management' },
  { key: 'landing_editor', icon: PanelTop, path: '/admin/landing-editor', labelKey: 'sidebar.landing_editor' },
  { key: 'interview_training', icon: Brain, path: '/admin/interview-training', labelKey: 'sidebar.interview_training' },
  { key: 'oncall', icon: Bell, path: '/admin/oncall', labelKey: 'sidebar.oncall' },
  { key: 'notifications', icon: Bell, path: '/admin/notifications', labelKey: 'sidebar.notifications' },
  { key: 'settings', icon: Settings, path: '/admin/settings', labelKey: 'sidebar.settings' },
];

export default function AdminLayout() {
  useSessionTimeout();
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background relative">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <video autoPlay muted loop playsInline className="w-full h-full object-cover opacity-[0.03]">
            <source src={dashboardBgAsset.url} type="video/mp4" />
          </video>
        </div>

        <AdminSidebar />
        <div className="flex-1 flex flex-col relative z-[1]">
          <FixedHeader>
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <Link to="/" className="flex items-center gap-2 md:hidden">
                <img src={logo} alt="AI SAP Support Now" className="w-8 h-8 rounded-lg object-contain" />
                <span className="font-bold text-sm text-foreground">AI SAP Support Now</span>
              </Link>
              <div className="relative hidden sm:block">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  placeholder="Search users, tickets..."
                  className="ps-9 pe-4 py-2 text-sm rounded-xl bg-muted/40 border border-border/40 focus:outline-none focus:ring-2 focus:ring-accent/50 w-64 transition-all focus:w-80"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell basePath="/admin" />
              <Badge variant="outline" className="text-xs bg-primary/5 border-primary/20 text-primary">Admin</Badge>
            </div>
          </FixedHeader>
          <FixedSubHeader>
            <HeaderNav role="admin" />
          </FixedSubHeader>
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6 pb-6 mt-14 md:mt-24">
            <PageTransition>
              <Outlet />
            </PageTransition>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
