import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Outlet } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import { Search, LayoutDashboard, Users, Kanban, UserCheck, BarChart3, Settings } from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Badge } from '@/components/ui/badge';

const bottomNavItems = [
  { key: 'dashboard', icon: LayoutDashboard, path: '/admin', labelKey: 'sidebar.dashboard' },
  { key: 'users', icon: Users, path: '/admin/users', labelKey: 'sidebar.users' },
  { key: 'tickets', icon: Kanban, path: '/admin/tickets', labelKey: 'sidebar.ticket_board' },
  { key: 'approvals', icon: UserCheck, path: '/admin/approvals', labelKey: 'sidebar.approvals' },
];

const moreNavItems = [
  { key: 'analytics', icon: BarChart3, path: '/admin/analytics', labelKey: 'sidebar.analytics' },
  { key: 'settings', icon: Settings, path: '/admin/settings', labelKey: 'sidebar.settings' },
];

export default function AdminLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AdminSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 border-b border-border/50 flex items-center justify-between px-4 bg-card/50 backdrop-blur sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="hidden md:flex" />
              <div className="relative hidden sm:block">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  placeholder="Search users, tickets..."
                  className="ps-9 pe-4 py-1.5 text-sm rounded-lg bg-muted/50 border border-border/50 focus:outline-none focus:ring-1 focus:ring-accent w-64"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell basePath="/admin" />
              <Badge variant="outline" className="text-xs">Admin</Badge>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
            <Outlet />
          </main>
        </div>
        <MobileBottomNav items={bottomNavItems} moreItems={moreNavItems} />
      </div>
    </SidebarProvider>
  );
}
