import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import ConsultantSidebar from '@/components/consultant/ConsultantSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import { Outlet } from 'react-router-dom';
import { Search, LayoutDashboard, Briefcase, Calendar, MessageSquare, CreditCard } from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Input } from '@/components/ui/input';

const bottomNavItems = [
  { key: 'dashboard', icon: LayoutDashboard, path: '/consultant', labelKey: 'sidebar.dashboard' },
  { key: 'cases', icon: Briefcase, path: '/consultant/cases', labelKey: 'sidebar.cases' },
  { key: 'calendar', icon: Calendar, path: '/consultant/calendar', labelKey: 'sidebar.calendar' },
  { key: 'chat', icon: MessageSquare, path: '/consultant/chat', labelKey: 'sidebar.chat' },
  { key: 'earnings', icon: CreditCard, path: '/consultant/earnings', labelKey: 'sidebar.earnings' },
];

export default function ConsultantLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <ConsultantSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b border-border/50 px-4 bg-background/80 backdrop-blur-xl sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hidden md:flex" />
              <div className="hidden md:flex items-center relative">
                <Search className="w-4 h-4 absolute start-3 text-muted-foreground" />
                <Input
                  placeholder="Search cases, clients..."
                  className="ps-9 h-9 w-64 rounded-xl bg-muted/50 border-0 focus-visible:ring-1"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell basePath="/consultant" />
              <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                AR
              </div>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6 overflow-auto pb-20 md:pb-6">
            <Outlet />
          </main>
        </div>
        <MobileBottomNav items={bottomNavItems} />
      </div>
    </SidebarProvider>
  );
}
