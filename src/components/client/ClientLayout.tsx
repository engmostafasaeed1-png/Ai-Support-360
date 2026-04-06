import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import ClientSidebar from '@/components/client/ClientSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import PageTransition from '@/components/PageTransition';
import { Outlet } from 'react-router-dom';
import {
  Search, AlertTriangle, LayoutDashboard, TicketPlus, Users,
  MessageSquare, Settings, Briefcase, Calendar, CreditCard,
  FileText, BookOpen, Bell, Plug,
} from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import dashboardBgAsset from '@/assets/videos/dashboard-bg.mp4.asset.json';

const bottomNavItems = [
  { key: 'dashboard', icon: LayoutDashboard, path: '/client', labelKey: 'sidebar.dashboard' },
  { key: 'new_request', icon: TicketPlus, path: '/client/new-request', labelKey: 'sidebar.new_request' },
  { key: 'consultants', icon: Users, path: '/client/consultants', labelKey: 'sidebar.consultants' },
  { key: 'chat', icon: MessageSquare, path: '/client/chat', labelKey: 'sidebar.chat' },
];

const moreNavItems = [
  { key: 'tickets', icon: Briefcase, path: '/client/tickets', labelKey: 'sidebar.tickets' },
  { key: 'sessions', icon: Calendar, path: '/client/sessions', labelKey: 'sidebar.sessions' },
  { key: 'payments', icon: CreditCard, path: '/client/payments', labelKey: 'sidebar.payments' },
  { key: 'invoices', icon: FileText, path: '/client/invoices', labelKey: 'sidebar.invoices' },
  { key: 'integrations', icon: Plug, path: '/client/integrations', labelKey: 'sidebar.integrations' },
  { key: 'knowledge', icon: BookOpen, path: '/client/knowledge', labelKey: 'sidebar.knowledge' },
  { key: 'notifications', icon: Bell, path: '/client/notifications', labelKey: 'sidebar.notifications' },
  { key: 'settings', icon: Settings, path: '/client/settings', labelKey: 'sidebar.settings' },
];

export default function ClientLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background relative">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <video autoPlay muted loop playsInline className="w-full h-full object-cover opacity-[0.03]">
            <source src={dashboardBgAsset.url} type="video/mp4" />
          </video>
        </div>

        <ClientSidebar />
        <div className="flex-1 flex flex-col min-w-0 relative z-[1]">
          <header className="h-14 flex items-center justify-between border-b border-border/40 px-4 bg-card/80 backdrop-blur-xl sticky top-0 z-30 shadow-sm">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground hidden md:flex" />
              <div className="hidden md:flex items-center relative">
                <Search className="w-4 h-4 absolute start-3 text-muted-foreground" />
                <Input
                  placeholder="Search tickets, consultants..."
                  className="ps-9 h-9 w-64 rounded-xl bg-muted/40 border-border/40 focus-visible:ring-accent/50 transition-all focus:w-80"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/client/new-request">
                <Button size="sm" variant="destructive" className="text-xs gap-1.5 shadow-sm hover:shadow-md transition-shadow">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Emergency Support</span>
                </Button>
              </Link>
              <NotificationBell basePath="/client" />
              <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-xs font-bold shadow-premium">
                KO
              </div>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6 overflow-auto pb-20 md:pb-6">
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
