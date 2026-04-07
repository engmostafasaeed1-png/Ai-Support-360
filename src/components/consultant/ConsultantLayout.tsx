import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import ConsultantSidebar from '@/components/consultant/ConsultantSidebar';
import MobileBottomNav from '@/components/MobileBottomNav';
import PageTransition from '@/components/PageTransition';
import MatchRequestPopup from '@/components/consultant/MatchRequestPopup';
import { FixedHeader, FixedSubHeader } from '@/components/layout/FixedHeader';
import { Outlet } from 'react-router-dom';
import {
  Search, LayoutDashboard, Briefcase, Calendar, MessageSquare,
  CreditCard, Star, User, ShieldCheck, BookOpen, Bell, Settings,
} from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Input } from '@/components/ui/input';
import dashboardBgAsset from '@/assets/videos/dashboard-bg.mp4.asset.json';
import HeaderNav from '@/components/HeaderNav';
import logo from '@/assets/logo.png';
import { Link } from 'react-router-dom';

const bottomNavItems = [
  { key: 'dashboard', icon: LayoutDashboard, path: '/consultant', labelKey: 'sidebar.dashboard' },
  { key: 'cases', icon: Briefcase, path: '/consultant/cases', labelKey: 'sidebar.cases' },
  { key: 'calendar', icon: Calendar, path: '/consultant/calendar', labelKey: 'sidebar.calendar' },
  { key: 'chat', icon: MessageSquare, path: '/consultant/chat', labelKey: 'sidebar.chat' },
];

const moreNavItems = [
  { key: 'earnings', icon: CreditCard, path: '/consultant/earnings', labelKey: 'sidebar.earnings' },
  { key: 'reviews', icon: Star, path: '/consultant/reviews', labelKey: 'sidebar.reviews' },
  { key: 'profile', icon: User, path: '/consultant/profile', labelKey: 'sidebar.profile' },
  { key: 'verification', icon: ShieldCheck, path: '/consultant/verification', labelKey: 'sidebar.verification' },
  { key: 'knowledge', icon: BookOpen, path: '/consultant/knowledge', labelKey: 'sidebar.knowledge' },
  { key: 'notifications', icon: Bell, path: '/consultant/notifications', labelKey: 'sidebar.notifications' },
  { key: 'settings', icon: Settings, path: '/consultant/settings', labelKey: 'sidebar.settings' },
];

export default function ConsultantLayout() {
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background relative">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <video autoPlay muted loop playsInline className="w-full h-full object-cover opacity-[0.03]">
            <source src={dashboardBgAsset.url} type="video/mp4" />
          </video>
        </div>

        <ConsultantSidebar />
        <div className="flex-1 flex flex-col min-w-0 relative z-[1]">
          <FixedHeader>
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground" />
              <Link to="/" className="flex items-center gap-2 md:hidden">
                <img src={logo} alt="AI SAP Support Hub" className="w-8 h-8 rounded-lg object-contain" />
                <span className="font-bold text-sm text-foreground">AI SAP Support Hub</span>
              </Link>
              <div className="hidden md:flex items-center relative">
                <Search className="w-4 h-4 absolute start-3 text-muted-foreground" />
                <Input
                  placeholder="Search cases, clients..."
                  className="ps-9 h-9 w-64 rounded-xl bg-muted/40 border-border/40 focus-visible:ring-accent/50 transition-all focus:w-80"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell basePath="/consultant" />
              <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-xs font-bold shadow-premium">
                AR
              </div>
            </div>
          </FixedHeader>
          <FixedSubHeader>
            <HeaderNav role="consultant" />
          </FixedSubHeader>
          <main className="flex-1 p-4 md:p-6 overflow-auto pb-20 md:pb-6 mt-14 md:mt-24">
            <PageTransition>
              <Outlet />
            </PageTransition>
          </main>
        </div>
        <MobileBottomNav items={bottomNavItems} moreItems={moreNavItems} />
        <MatchRequestPopup />
      </div>
    </SidebarProvider>
  );
}
