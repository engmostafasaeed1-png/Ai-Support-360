import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import ConsultantSidebar from '@/components/consultant/ConsultantSidebar';
import PageTransition from '@/components/PageTransition';
import MatchRequestPopup from '@/components/consultant/MatchRequestPopup';
import { FixedHeader, FixedSubHeader } from '@/components/layout/FixedHeader';
import { Outlet } from 'react-router-dom';
import { Search, Briefcase, Building2, Zap, Plus } from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Input } from '@/components/ui/input';
import dashboardBgAsset from '@/assets/videos/dashboard-bg.mp4.asset.json';
import HeaderNav from '@/components/HeaderNav';
import logo from '@/assets/logo.png';
import { Link, useNavigate } from 'react-router-dom';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import SecurityAlert from '@/components/SecurityAlert';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export default function ConsultantLayout() {
  useSessionTimeout();
  const { profile } = useUserProfile();

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
                <img src={logo} alt="AI SAP Support Now" className="w-8 h-8 rounded-lg object-contain" />
                <span className="font-bold text-sm text-foreground">AI SAP Support Now</span>
              </Link>
              <div className="hidden md:flex items-center relative">
                <Search className="w-4 h-4 absolute start-3 text-muted-foreground" />
                <Input
                  placeholder="Search cases, clients..."
                  className="ps-9 h-9 w-64 rounded-xl bg-muted/40 border-border/40 focus-visible:ring-accent/50 transition-all focus:w-80"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Badge className="bg-primary/10 text-primary border border-primary/30 px-3 py-1 text-xs font-semibold gap-1.5">
                <Briefcase className="w-3.5 h-3.5" />
                Consultant
              </Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs gap-1.5 border-border/50 hover:bg-accent/10"
                    onClick={() => window.location.href = '/client'}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Switch to Client</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Switch to Client view</p>
                </TooltipContent>
              </Tooltip>
              {/* AI Credits */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent/10 border border-accent/20">
                    <Zap className="w-3.5 h-3.5 text-accent" />
                    <span className="text-xs font-semibold text-accent">42</span>
                    <span className="text-[10px] text-muted-foreground">credits</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">AI credits consumed this month</p>
                </TooltipContent>
              </Tooltip>

              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2.5 text-xs gap-1 border-accent/30 text-accent hover:bg-accent/10"
                onClick={() => window.open('https://pay.link/recharge', '_blank')}
              >
                <Plus className="w-3 h-3" />
                <span className="hidden sm:inline">Recharge</span>
              </Button>

              <NotificationBell basePath="/consultant" />

              {/* Profile avatar with name */}
              <Link to="/consultant/profile" className="flex items-center gap-2 group">
                <Avatar className="w-8 h-8 ring-2 ring-border group-hover:ring-accent/50 transition-all">
                  {profile?.avatarUrl && <AvatarImage src={profile.avatarUrl} alt={profile.displayName} />}
                  <AvatarFallback className="bg-gradient-to-br from-accent to-primary text-primary-foreground text-xs font-bold">
                    {profile?.initials || 'U'}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden lg:block text-sm font-medium text-foreground max-w-[120px] truncate group-hover:text-accent transition-colors">
                  {profile?.displayName || 'User'}
                </span>
              </Link>
            </div>
          </FixedHeader>
          <FixedSubHeader>
            <HeaderNav role="consultant" />
          </FixedSubHeader>
          <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-auto pb-6 mt-14 md:mt-24 protected-content">
            <SecurityAlert />
            <PageTransition>
              <Outlet />
            </PageTransition>
          </main>
        </div>
        <MatchRequestPopup />
      </div>
    </SidebarProvider>
  );
}
