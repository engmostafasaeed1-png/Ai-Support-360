import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Outlet } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import PageTransition from '@/components/PageTransition';
import { Search, LayoutDashboard, Users, Kanban, UserCheck, BarChart3, Settings, Plug } from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Badge } from '@/components/ui/badge';
import dashboardBgAsset from '@/assets/videos/dashboard-bg.mp4.asset.json';
import HeaderNav from '@/components/HeaderNav';

const bottomNavItems = [
  { key: 'dashboard', icon: LayoutDashboard, path: '/admin', labelKey: 'sidebar.dashboard' },
  { key: 'users', icon: Users, path: '/admin/users', labelKey: 'sidebar.users' },
  { key: 'tickets', icon: Kanban, path: '/admin/tickets', labelKey: 'sidebar.ticket_board' },
  { key: 'approvals', icon: UserCheck, path: '/admin/approvals', labelKey: 'sidebar.approvals' },
];

const moreNavItems = [
  { key: 'analytics', icon: BarChart3, path: '/admin/analytics', labelKey: 'sidebar.analytics' },
  { key: 'integrations', icon: Plug, path: '/admin/integrations', labelKey: 'sidebar.integrations' },
  { key: 'settings', icon: Settings, path: '/admin/settings', labelKey: 'sidebar.settings' },
];

export default function AdminLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background relative">
        {/* Subtle video background for dashboards */}
        <div className="fixed inset-0 z-0 pointer-events-none">
          <video
            autoPlay muted loop playsInline
            className="w-full h-full object-cover opacity-[0.03]"
          >
            <source src={dashboardBgAsset.url} type="video/mp4" />
          </video>
        </div>

        <AdminSidebar />
        <div className="flex-1 flex flex-col relative z-[1]">
          <header className="h-14 border-b border-border/40 flex items-center justify-between px-4 bg-card/80 backdrop-blur-xl sticky top-0 z-10 shadow-sm">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="hidden md:flex" />
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
          </header>
          <div className="border-b border-border/30 bg-card/60 backdrop-blur-sm sticky top-14 z-20 hidden md:block">
            <HeaderNav role="admin" />
          </div>
          <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
            <PageTransition>
              <Outlet />
            </PageTransition>
          </main>
        </div>
        <MobileBottomNav items={bottomNavItems} moreItems={moreNavItems} />
      </div>
    </SidebarProvider>
  );
}
