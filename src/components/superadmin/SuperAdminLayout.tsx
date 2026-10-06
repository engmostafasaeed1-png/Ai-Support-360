import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Outlet } from 'react-router-dom';
import SuperAdminSidebar from './SuperAdminSidebar';
import PageTransition from '@/components/PageTransition';
import { FixedHeader, FixedSubHeader } from '@/components/layout/FixedHeader';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Badge } from '@/components/ui/badge';
import { Crown } from 'lucide-react';
import dashboardBgAsset from '@/assets/videos/dashboard-bg.mp4.asset.json';
import HeaderNav from '@/components/HeaderNav';
import logo from '@/assets/brand/mark.png.asset.json';
import { Link } from 'react-router-dom';

export default function SuperAdminLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background relative">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <video autoPlay muted loop playsInline className="w-full h-full object-cover opacity-[0.03]">
            <source src={dashboardBgAsset.url} type="video/mp4" />
          </video>
        </div>

        <SuperAdminSidebar />
        <div className="flex-1 flex flex-col relative z-[1]">
          <FixedHeader>
            <div className="flex items-center gap-3">
              <SidebarTrigger />
              <Link to="/" className="flex items-center gap-2 md:hidden">
                <img src={logo.url} alt="AI Support 360" className="w-8 h-8 rounded-lg object-contain" />
                <span className="font-bold text-sm text-foreground">AI Support 360</span>
              </Link>
              <Badge className="bg-gradient-to-r from-amber-500 to-orange-600 text-white border-0 text-[10px] gap-1 shadow-sm">
                <Crown className="w-3 h-3" />
                Super Admin
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell basePath="/super-admin" />
            </div>
          </FixedHeader>
          <FixedSubHeader>
            <HeaderNav role="super-admin" />
          </FixedSubHeader>
          <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-6 mt-14 md:mt-24">
            <PageTransition>
              <Outlet />
            </PageTransition>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
