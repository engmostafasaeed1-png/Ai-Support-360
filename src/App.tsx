import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GuestModeProvider } from "./contexts/GuestModeContext.tsx";
import { TenantProvider } from "./contexts/TenantContext.tsx";
import GuestBanner from "./components/guest/GuestBanner.tsx";
import AIChatbot from "./components/chatbot/AIChatbot.tsx";
import MaintenanceBanner from "./components/MaintenanceBanner.tsx";
import ScrollToTop from "./components/ScrollToTop.tsx";
import ScreenProtection from "./components/ScreenProtection.tsx";
import WhatsAppButton from "./components/WhatsAppButton.tsx";
import GlobalSearch from "./components/GlobalSearch.tsx";

// Admin console section imports
import OverviewSection from "./components/admin/console/sections/OverviewSection.tsx";
import UserManagementSection from "./components/admin/console/sections/UserManagementSection.tsx";
import RolesPermissionsSection from "./components/admin/console/sections/RolesPermissionsSection.tsx";
import SubscriptionsSection from "./components/admin/console/sections/SubscriptionsSection.tsx";
import { SecuritySettingsSection, AuthenticationSection, DataAccessSection, AuditLogSection } from "./components/admin/console/sections/SecuritySections.tsx";
import { TicketManagementSection, ConsultantApprovalsSection, NDAManagementSection, MatchRequestsSection, ProjectsMilestonesSection } from "./components/admin/console/sections/OperationsSections.tsx";
import { NotificationsSection, LocalizationSection, AppearanceSection, StorageSection, EmailSection, IntegrationsSection as AdminIntSection, EnvironmentsSection, LandingEditorSection, PlatformSettingsSection, MaintenanceSection } from "./components/admin/console/sections/SystemSections.tsx";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import ConsultantLayout from "./components/consultant/ConsultantLayout.tsx";
import ConsultantDashboard from "./pages/consultant/ConsultantDashboard.tsx";
import CasesPage from "./pages/consultant/CasesPage.tsx";
import CaseDetailPage from "./pages/consultant/CaseDetailPage.tsx";
import RequestsPage from "./pages/consultant/RequestsPage.tsx";
import ProposalsPage from "./pages/consultant/ProposalsPage.tsx";
import OpenTicketsPage from "./pages/consultant/OpenTicketsPage.tsx";
import WorkDiaryPage from "./pages/consultant/WorkDiaryPage.tsx";
import MilestonesPage from "./pages/client/MilestonesPage.tsx";
import MatchRequestPopup from "./components/consultant/MatchRequestPopup.tsx";
import CalendarPage from "./pages/consultant/CalendarPage.tsx";
import EarningsPage from "./pages/consultant/EarningsPage.tsx";
import VerificationPage from "./pages/consultant/VerificationPage.tsx";
import ProfilePage from "./pages/consultant/ProfilePage.tsx";
import OnboardingPage from "./pages/consultant/OnboardingPage.tsx";
import InterviewsPage from "./pages/consultant/InterviewsPage.tsx";
import InterviewTrainingPage from "./pages/admin/InterviewTrainingPage.tsx";
import ConsultantChatPage from "./pages/consultant/ConsultantChatPage.tsx";
import ClientLayout from "./components/client/ClientLayout.tsx";
import ClientDashboard from "./pages/client/ClientDashboard.tsx";
import NewRequestPage from "./pages/client/NewRequestPage.tsx";
import TicketsPage from "./pages/client/TicketsPage.tsx";
import TicketDetailPage from "./pages/client/TicketDetailPage.tsx";
import ConsultantsPage from "./pages/client/ConsultantsPage.tsx";
import ConsultantProfilePage from "./pages/client/ConsultantProfilePage.tsx";
import PaymentsPage from "./pages/client/PaymentsPage.tsx";
import ClientChatPage from "./pages/client/ClientChatPage.tsx";
import ClientOnboardingPage from "./pages/client/ClientOnboardingPage.tsx";
import SessionsPage from "./pages/client/SessionsPage.tsx";
import VideoSessionsPage from "./pages/client/VideoSessionsPage.tsx";
import SessionDetailPage from "./pages/client/SessionDetailPage.tsx";
import SettingsPage from "./pages/client/SettingsPage.tsx";
import IntegrationsPage from "./pages/client/IntegrationsPage.tsx";
import CompanyProfilePage from "./pages/client/CompanyProfilePage.tsx";
import CompanySelectorPage from "./pages/client/CompanySelectorPage.tsx";
import ChatSessionPage from "./pages/chat/ChatSessionPage.tsx";
import NotificationsPage from "./pages/notifications/NotificationsPage.tsx";
import PricingPage from "./pages/PricingPage.tsx";
import AdminLayout from "./components/admin/AdminLayout.tsx";
import AdminDashboard from "./pages/admin/AdminDashboard.tsx";
import UsersPage from "./pages/admin/UsersPage.tsx";
import TicketKanbanPage from "./pages/admin/TicketKanbanPage.tsx";
import ConsultantApprovalsPage from "./pages/admin/ConsultantApprovalsPage.tsx";
import AnalyticsPage from "./pages/admin/AnalyticsPage.tsx";
import AdminIntegrationsPage from "./pages/admin/AdminIntegrationsPage.tsx";
import EnvironmentsPage from "./pages/admin/EnvironmentsPage.tsx";
import EnvironmentLogsPage from "./pages/admin/EnvironmentLogsPage.tsx";
import AdminSettingsPage from "./pages/admin/AdminSettingsPage.tsx";
import NDAManagementPage from "./pages/admin/NDAManagementPage.tsx";
import LoginPage from "./pages/auth/LoginPage.tsx";
import SignupPage from "./pages/auth/SignupPage.tsx";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage.tsx";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage.tsx";
import ProtectedRoute from "./components/auth/ProtectedRoute.tsx";
import RemoteAccessPage from "./pages/consultant/RemoteAccessPage.tsx";
import ClientRemoteAccessPage from "./pages/client/RemoteAccessPage.tsx";
import InvoicesPage from "./pages/client/InvoicesPage.tsx";
import KnowledgePage from "./pages/client/KnowledgePage.tsx";
import ActivityLogPage from "./pages/client/ActivityLogPage.tsx";
import SLAPage from "./pages/client/SLAPage.tsx";
import TeamMembersPage from "./pages/client/TeamMembersPage.tsx";
import ClientReportsPage from "./pages/client/ReportsPage.tsx";
import ReviewsPage from "./pages/consultant/ReviewsPage.tsx";
import ConsultantSettingsPage from "./pages/consultant/SettingsPage.tsx";
import ConsultantKnowledgePage from "./pages/consultant/KnowledgePage.tsx";
import ConsultantReportsPage from "./pages/consultant/ReportsPage.tsx";
import SuperAdminLayout from "./components/superadmin/SuperAdminLayout.tsx";
import SuperAdminOverview from "./pages/superadmin/SuperAdminOverview.tsx";
import RolesAuthPage from "./pages/superadmin/RolesAuthPage.tsx";
import UserManagementPage from "./pages/superadmin/UserManagementPage.tsx";
import ReportsPage from "./pages/superadmin/ReportsPage.tsx";
import ConfigPage from "./pages/superadmin/ConfigPage.tsx";
import WorkflowsPage from "./pages/superadmin/WorkflowsPage.tsx";
import AuditLogsPage from "./pages/superadmin/AuditLogsPage.tsx";
import SystemHealthPage from "./pages/superadmin/SystemHealthPage.tsx";
import ExecutiveDashboardPage from "./pages/superadmin/ExecutiveDashboardPage.tsx";
import ReferralsPage from "./pages/ReferralsPage.tsx";
import TaskBoardPage from "./pages/client/TaskBoardPage.tsx";
import ProjectsPage from "./pages/client/ProjectsPage.tsx";
import ContractsPage from "./pages/client/ContractsPage.tsx";
import SupportPage from "./pages/client/SupportPage.tsx";
import ProjectManagementTicketsPage from "./pages/client/ProjectManagementTicketsPage.tsx";
import SolutionArchitecturePage from "./pages/client/SolutionArchitecturePage.tsx";
import ChangeManagementPage from "./pages/client/ChangeManagementPage.tsx";
import ProblemManagementPage from "./pages/client/ProblemManagementPage.tsx";
import ServiceCatalogPage from "./pages/client/ServiceCatalogPage.tsx";
import MajorIncidentsPage from "./pages/client/MajorIncidentsPage.tsx";
import PlaybooksPage from "./pages/client/PlaybooksPage.tsx";
import OnCallSchedulePage from "./pages/admin/OnCallSchedulePage.tsx";
import LandingEditorPage from "./pages/admin/LandingEditorPage.tsx";
import AdminConsolePage from "./pages/admin/AdminConsolePage.tsx";
import AdminVMwareSettingsPage from "./pages/admin/VMwareSettingsPage.tsx";
import ClientVMwareSettingsPage from "./pages/client/VMwareSettingsPage.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <GuestModeProvider>
        <TenantProvider>
          <ScrollToTop />
          <ScreenProtection />
          <GlobalSearch />
          <MaintenanceBanner />
          <GuestBanner />
          <AIChatbot />
          <WhatsAppButton />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/consultant" element={<ProtectedRoute requiredRole="consultant"><ConsultantLayout /></ProtectedRoute>}>
              <Route index element={<ConsultantDashboard />} />
              <Route path="cases" element={<CasesPage />} />
              <Route path="cases/:caseId" element={<CaseDetailPage />} />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="earnings" element={<EarningsPage />} />
              <Route path="verification" element={<VerificationPage />} />
              <Route path="interviews" element={<InterviewsPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="chat" element={<ConsultantChatPage />} />
              <Route path="chat/:sessionId" element={<ChatSessionPage role="consultant" />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="onboarding" element={<OnboardingPage />} />
              <Route path="remote-access" element={<RemoteAccessPage />} />
              <Route path="reviews" element={<ReviewsPage />} />
              <Route path="settings" element={<ConsultantSettingsPage />} />
              <Route path="knowledge" element={<ConsultantKnowledgePage />} />
              <Route path="proposals" element={<ProposalsPage />} />
              <Route path="open-tickets" element={<OpenTicketsPage />} />
              <Route path="tickets/:ticketId" element={<TicketDetailPage />} />
              <Route path="work-diary" element={<WorkDiaryPage />} />
              <Route path="reports" element={<ConsultantReportsPage />} />
              <Route path="referrals" element={<ReferralsPage />} />
            </Route>
            <Route path="/client/companies" element={<ProtectedRoute requiredRole="client"><CompanySelectorPage /></ProtectedRoute>} />
            <Route path="/client" element={<ProtectedRoute requiredRole="client"><ClientLayout /></ProtectedRoute>}>
              <Route index element={<ClientDashboard />} />
              <Route path="new-request" element={<NewRequestPage />} />
              <Route path="tickets" element={<TicketsPage />} />
              <Route path="tickets/:ticketId" element={<TicketDetailPage />} />
              <Route path="consultants" element={<ConsultantsPage />} />
              <Route path="consultants/:id" element={<ConsultantProfilePage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="sessions" element={<SessionsPage />} />
              <Route path="video-sessions" element={<VideoSessionsPage />} />
              <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
              <Route path="chat" element={<ClientChatPage />} />
              <Route path="chat/:sessionId" element={<ChatSessionPage role="client" />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="company" element={<CompanyProfilePage />} />
              <Route path="integrations" element={<IntegrationsPage />} />
              <Route path="onboarding" element={<ClientOnboardingPage />} />
              <Route path="remote-access" element={<ClientRemoteAccessPage />} />
              <Route path="vmware-settings" element={<ClientVMwareSettingsPage />} />
              <Route path="invoices" element={<InvoicesPage />} />
              <Route path="knowledge" element={<KnowledgePage />} />
              <Route path="milestones" element={<MilestonesPage />} />
              <Route path="activity-log" element={<ActivityLogPage />} />
              <Route path="sla" element={<SLAPage />} />
              <Route path="team" element={<TeamMembersPage />} />
              <Route path="reports" element={<ClientReportsPage />} />
              <Route path="referrals" element={<ReferralsPage />} />
              <Route path="tasks" element={<TaskBoardPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="contracts" element={<ContractsPage />} />
              <Route path="support" element={<SupportPage />} />
              <Route path="pm-tickets" element={<ProjectManagementTicketsPage />} />
              <Route path="solution-architecture" element={<SolutionArchitecturePage />} />
              <Route path="changes" element={<ChangeManagementPage />} />
              <Route path="problems" element={<ProblemManagementPage />} />
              <Route path="catalog" element={<ServiceCatalogPage />} />
              <Route path="major-incidents" element={<MajorIncidentsPage />} />
              <Route path="playbooks" element={<PlaybooksPage />} />
            </Route>
            <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminLayout /></ProtectedRoute>}>
              <Route index element={<AdminConsolePage />} />
              <Route path="console" element={<AdminConsolePage />}>
                <Route index element={<OverviewSection />} />
                <Route path="users" element={<UserManagementSection />} />
                <Route path="roles" element={<RolesPermissionsSection />} />
                <Route path="subscriptions" element={<SubscriptionsSection />} />
                <Route path="tickets" element={<TicketManagementSection />} />
                <Route path="approvals" element={<ConsultantApprovalsSection />} />
                <Route path="nda" element={<NDAManagementSection />} />
                <Route path="match-requests" element={<MatchRequestsSection />} />
                <Route path="projects" element={<ProjectsMilestonesSection />} />
                <Route path="security" element={<SecuritySettingsSection />} />
                <Route path="auth" element={<AuthenticationSection />} />
                <Route path="rls" element={<DataAccessSection />} />
                <Route path="audit" element={<AuditLogSection />} />
                <Route path="notifications" element={<NotificationsSection />} />
                <Route path="localization" element={<LocalizationSection />} />
                <Route path="appearance" element={<AppearanceSection />} />
                <Route path="storage" element={<StorageSection />} />
                <Route path="email" element={<EmailSection />} />
                <Route path="integrations" element={<AdminIntSection />} />
                <Route path="environments" element={<EnvironmentsSection />} />
                <Route path="landing" element={<LandingEditorSection />} />
                <Route path="settings" element={<PlatformSettingsSection />} />
                <Route path="maintenance" element={<MaintenanceSection />} />
              </Route>
              <Route path="users" element={<UsersPage />} />
              <Route path="tickets" element={<TicketKanbanPage />} />
              <Route path="tickets/:ticketId" element={<TicketDetailPage />} />
              <Route path="approvals" element={<ConsultantApprovalsPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="integrations" element={<AdminIntegrationsPage />} />
              <Route path="environments" element={<EnvironmentsPage />} />
              <Route path="vmware-settings" element={<AdminVMwareSettingsPage />} />
              <Route path="environment-logs" element={<EnvironmentLogsPage />} />
              <Route path="settings" element={<AdminSettingsPage />} />
              <Route path="nda-management" element={<NDAManagementPage />} />
              <Route path="landing-editor" element={<LandingEditorPage />} />
              <Route path="interview-training" element={<InterviewTrainingPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="oncall" element={<OnCallSchedulePage />} />
            </Route>
            <Route path="/super-admin" element={<ProtectedRoute requiredRole="admin"><SuperAdminLayout /></ProtectedRoute>}>
              <Route index element={<SuperAdminOverview />} />
              <Route path="executive" element={<ExecutiveDashboardPage />} />
              <Route path="roles" element={<RolesAuthPage />} />
              <Route path="users" element={<UserManagementPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="config" element={<ConfigPage />} />
              <Route path="workflows" element={<WorkflowsPage />} />
              <Route path="audit" element={<AuditLogsPage />} />
              <Route path="system" element={<SystemHealthPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </TenantProvider>
        </GuestModeProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
