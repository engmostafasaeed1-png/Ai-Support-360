import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Outlet } from 'react-router-dom';
import SuperAdminSidebar from './SuperAdminSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import { LayoutDashboard, ShieldCheck, BarChart3, Settings2, Users } from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Badge } from '@/components/ui/badge';
import { Crown } from 'lucide-react';

const bottomNavItems = [
  { key: 'overview', icon: LayoutDashboard, path: '/super-admin', labelKey: 'super_admin.overview' },
  { key: 'roles', icon: ShieldCheck, path: '/super-admin/roles', labelKey: 'super_admin.roles' },
  { key: 'users', icon: Users, path: '/super-admin/users', labelKey: 'super_admin.user_management' },
  { key: 'reports', icon: BarChart3, path: '/super-admin/reports', labelKey: 'super_admin.reports' },
];

const moreNavItems = [
  { key: 'config', icon: Settings2, path: '/super-admin/config', labelKey: 'super_admin.config' },
];

export default function SuperAdminLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <SuperAdminSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 border-b border-border/50 flex items-center justify-between px-4 bg-card/50 backdrop-blur sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="hidden md:flex" />
              <Badge className="bg-gradient-to-r from-amber-500 to-orange-600 text-white border-0 text-[10px] gap-1">
                <Crown className="w-3 h-3" />
                Super Admin
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell basePath="/super-admin" />
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
