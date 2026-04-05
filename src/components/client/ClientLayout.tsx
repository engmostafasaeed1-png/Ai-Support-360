import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import ClientSidebar from '@/components/client/ClientSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import { Outlet } from 'react-router-dom';
import { Search, AlertTriangle, LayoutDashboard, TicketPlus, Users, MessageSquare, Settings } from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';

const bottomNavItems = [
  { key: 'dashboard', icon: LayoutDashboard, path: '/client', labelKey: 'sidebar.dashboard' },
  { key: 'new_request', icon: TicketPlus, path: '/client/new-request', labelKey: 'sidebar.new_request' },
  { key: 'consultants', icon: Users, path: '/client/consultants', labelKey: 'sidebar.consultants' },
  { key: 'chat', icon: MessageSquare, path: '/client/chat', labelKey: 'sidebar.chat' },
  { key: 'settings', icon: Settings, path: '/client/settings', labelKey: 'sidebar.settings' },
];

export default function ClientLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <ClientSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b border-border/50 px-4 bg-background/80 backdrop-blur-xl sticky top-0 z-30">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hidden md:flex" />
              <div className="hidden md:flex items-center relative">
                <Search className="w-4 h-4 absolute start-3 text-muted-foreground" />
                <Input
                  placeholder="Search tickets, consultants..."
                  className="ps-9 h-9 w-64 rounded-xl bg-muted/50 border-0 focus-visible:ring-1"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/client/new-request">
                <Button size="sm" variant="destructive" className="text-xs gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Emergency Support</span>
                </Button>
              </Link>
              <NotificationBell basePath="/client" />
              <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
                KO
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
