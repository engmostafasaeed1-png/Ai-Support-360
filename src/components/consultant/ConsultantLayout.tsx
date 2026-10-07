import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import ConsultantSidebar from '@/components/consultant/ConsultantSidebar';
import PageTransition from '@/components/PageTransition';
import MatchRequestPopup from '@/components/consultant/MatchRequestPopup';
import { FixedHeader, FixedSubHeader } from '@/components/layout/FixedHeader';
import { Outlet } from 'react-router-dom';
import { Briefcase, Building2, Zap } from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import HeaderSearchButton from '@/components/layout/HeaderSearchButton';
import HeaderNav from '@/components/HeaderNav';
import logo from '@/assets/brand/mark.png.asset.json';
import { Link, useNavigate } from 'react-router-dom';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import SecurityAlert from '@/components/SecurityAlert';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useConsultantProfile } from '@/hooks/useConsultantProfile';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export default function ConsultantLayout() {
  const navigate = useNavigate();
  useSessionTimeout();
  const { profile } = useUserProfile();
  const { data: consultantProfile } = useConsultantProfile();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-canvas relative">

        <ConsultantSidebar />
        <div className="flex-1 flex flex-col min-w-0 relative z-[1]">
          <FixedHeader>
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground" />
              <Link to="/" className="flex items-center gap-2 md:hidden">
                <img src={logo.url} alt="AI Support 360" className="w-8 h-8 rounded-lg object-contain" />
                <span className="hidden font-bold text-sm text-foreground sm:inline">AI Support 360</span>
              </Link>
              <HeaderSearchButton placeholder="Search cases, clients..." />
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <Badge className="hidden xl:inline-flex bg-primary/10 text-primary border border-primary/30 px-3 py-1 text-xs font-semibold gap-1.5">
                <Briefcase className="w-3.5 h-3.5" />
                Consultant
              </Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs gap-1.5 border-border/50 hover:bg-accent/10"
                    onClick={() => navigate('/client')}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span className="hidden xl:inline">Switch to Client</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Switch to Client view</p>
                </TooltipContent>
              </Tooltip>
              {/* Credibility credits earned from the AI interview and platform rewards */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/consultant/credits"
                    className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-accent/10 border border-accent/20 hover:bg-accent/20 transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5 text-accent" />
                    <span className="text-xs font-semibold text-accent">{consultantProfile ? consultantProfile.credibility_credits : '–'}</span>
                    <span className="text-[10px] text-muted-foreground">credits</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Credibility credits you have earned</p>
                </TooltipContent>
              </Tooltip>

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
