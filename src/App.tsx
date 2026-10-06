import React, { Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { logger } from '@/lib/logger';
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GuestModeProvider } from "./contexts/GuestModeContext.tsx";
import { CurrencyProvider } from "./contexts/CurrencyContext.tsx";
import { TenantProvider } from "./contexts/TenantContext.tsx";
import GuestBanner from "./components/guest/GuestBanner.tsx";
import AIChatbot from "./components/chatbot/AIChatbot.tsx";
import MaintenanceBanner from "./components/MaintenanceBanner.tsx";
import ScrollToTop from "./components/ScrollToTop.tsx";
import RouteSeo from "./components/RouteSeo";
import { HelmetProvider } from "react-helmet-async";
import Watermark from "./components/Watermark.tsx";
import WhatsAppButton from "./components/WhatsAppButton.tsx";
import GlobalSearch from "./components/GlobalSearch.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { Loader2 } from 'lucide-react';

// Eager layout imports
import ConsultantLayout from "./components/consultant/ConsultantLayout.tsx";
import ClientLayout from "./components/client/ClientLayout.tsx";
import AdminLayout from "./components/admin/AdminLayout.tsx";
import SuperAdminLayout from "./components/superadmin/SuperAdminLayout.tsx";
import ProtectedRoute from "./components/auth/ProtectedRoute.tsx";

// Admin console sections (eagerly loaded since they're small)
import OverviewSection from "./components/admin/console/sections/OverviewSection.tsx";
import UserManagementSection from "./components/admin/console/sections/UserManagementSection.tsx";
import RolesPermissionsSection from "./components/admin/console/sections/RolesPermissionsSection.tsx";
import SubscriptionsSection from "./components/admin/console/sections/SubscriptionsSection.tsx";
import { SecuritySettingsSection, AuthenticationSection, DataAccessSection, AuditLogSection } from "./components/admin/console/sections/SecuritySections.tsx";
import { TicketManagementSection, ConsultantApprovalsSection, NDAManagementSection, MatchRequestsSection, ProjectsMilestonesSection } from "./components/admin/console/sections/OperationsSections.tsx";
import { NotificationsSection, LocalizationSection, AppearanceSection, StorageSection, EmailSection, IntegrationsSection as AdminIntSection, EnvironmentsSection, LandingEditorSection, PlatformSettingsSection, MaintenanceSection } from "./components/admin/console/sections/SystemSections.tsx";
import { AnalyticsConsoleSection, VMwareSettingsConsoleSection, EnvironmentLogsConsoleSection, MeetingEventsConsoleSection, InterviewTrainingConsoleSection, OnCallScheduleConsoleSection } from "./components/admin/console/sections/AdditionalSections.tsx";

// Lazy page imports
const Index = React.lazy(() => import("./pages/Index.tsx"));
const NotFound = React.lazy(() => import("./pages/NotFound.tsx"));
const MeetingHandoffPage = React.lazy(() => import("./pages/MeetingHandoffPage.tsx"));
const PricingPage = React.lazy(() => import("./pages/PricingPage.tsx"));
const LegalPage = React.lazy(() => import("./pages/LegalPage.tsx"));
const ServiceModulePage = React.lazy(() => import("./pages/ServiceModulePage.tsx"));
const DemoRequestConfirmationPage = React.lazy(() => import("./pages/DemoRequestConfirmationPage.tsx"));
const UnsubscribePage = React.lazy(() => import("./pages/UnsubscribePage.tsx"));
const LoginPage = React.lazy(() => import("./pages/auth/LoginPage.tsx"));
const OAuthConsentPage = React.lazy(() => import("./pages/auth/OAuthConsentPage.tsx"));
const SignupPage = React.lazy(() => import("./pages/auth/SignupPage.tsx"));
const ForgotPasswordPage = React.lazy(() => import("./pages/auth/ForgotPasswordPage.tsx"));
const VerificationTimelineHarness = React.lazy(
  () => import("./pages/dev/VerificationTimelineHarness.tsx"),
);
const ResetPasswordPage = React.lazy(() => import("./pages/auth/ResetPasswordPage.tsx"));

// Consultant pages
const ConsultantDashboard = React.lazy(() => import("./pages/consultant/ConsultantDashboard.tsx"));
const CasesPage = React.lazy(() => import("./pages/consultant/CasesPage.tsx"));
const CaseDetailPage = React.lazy(() => import("./pages/consultant/CaseDetailPage.tsx"));
const RequestsPage = React.lazy(() => import("./pages/consultant/RequestsPage.tsx"));
const ProposalsPage = React.lazy(() => import("./pages/consultant/ProposalsPage.tsx"));
const OpenTicketsPage = React.lazy(() => import("./pages/consultant/OpenTicketsPage.tsx"));
const WorkDiaryPage = React.lazy(() => import("./pages/consultant/WorkDiaryPage.tsx"));
const CalendarPage = React.lazy(() => import("./pages/consultant/CalendarPage.tsx"));
const EarningsPage = React.lazy(() => import("./pages/consultant/ConsultantEarningsPage.tsx"));
const VerificationPage = React.lazy(() => import("./pages/consultant/VerificationPage.tsx"));
const ProfilePage = React.lazy(() => import("./pages/consultant/ProfilePage.tsx"));
const OnboardingPage = React.lazy(() => import("./pages/consultant/OnboardingPage.tsx"));
const InterviewsPage = React.lazy(() => import("./pages/consultant/InterviewsPage.tsx"));
const ConsultantChatPage = React.lazy(() => import("./pages/consultant/ConsultantChatPage.tsx"));
const RemoteAccessPage = React.lazy(() => import("./pages/consultant/RemoteAccessPage.tsx"));
const ReviewsPage = React.lazy(() => import("./pages/consultant/ReviewsPage.tsx"));
const ConsultantSettingsPage = React.lazy(() => import("./pages/consultant/SettingsPage.tsx"));
const ConsultantKnowledgePage = React.lazy(() => import("./pages/consultant/KnowledgePage.tsx"));
const ConsultantReportsPage = React.lazy(() => import("./pages/consultant/ReportsPage.tsx"));
const ConsultantBusinessProcessesPage = React.lazy(() => import("./pages/consultant/BusinessProcessesPage.tsx"));
const CreditsRulesPage = React.lazy(() => import("./pages/consultant/CreditsRulesPage.tsx"));

// Client pages
const ClientDashboard = React.lazy(() => import("./pages/client/ClientDashboard.tsx"));
const TimelinePage = React.lazy(() => import("./pages/client/TimelinePage.tsx"));
const NewRequestPage = React.lazy(() => import("./pages/client/NewRequestPage.tsx"));
const TicketsPage = React.lazy(() => import("./pages/client/TicketsPage.tsx"));
const TicketDetailPage = React.lazy(() => import("./pages/client/TicketDetailPage.tsx"));
const ConsultantsPage = React.lazy(() => import("./pages/client/ConsultantsPage.tsx"));
const ConsultantProfilePage = React.lazy(() => import("./pages/client/ConsultantProfilePage.tsx"));
const PaymentsPage = React.lazy(() => import("./pages/client/PaymentsPage.tsx"));
const ClientChatPage = React.lazy(() => import("./pages/client/ClientChatPage.tsx"));
const ClientOnboardingPage = React.lazy(() => import("./pages/client/ClientOnboardingPage.tsx"));
const SessionsPage = React.lazy(() => import("./pages/client/SessionsPage.tsx"));
const VideoSessionsPage = React.lazy(() => import("./pages/client/VideoSessionsPage.tsx"));
const SessionDetailPage = React.lazy(() => import("./pages/client/SessionDetailPage.tsx"));
const SettingsPage = React.lazy(() => import("./pages/client/SettingsPage.tsx"));
const IntegrationsPage = React.lazy(() => import("./pages/client/IntegrationsPage.tsx"));
const CompanyProfilePage = React.lazy(() => import("./pages/client/CompanyProfilePage.tsx"));
const CompanySelectorPage = React.lazy(() => import("./pages/client/CompanySelectorPage.tsx"));
const ClientRemoteAccessPage = React.lazy(() => import("./pages/client/RemoteAccessPage.tsx"));
const InvoicesPage = React.lazy(() => import("./pages/client/InvoicesPage.tsx"));
const KnowledgePage = React.lazy(() => import("./pages/client/KnowledgePage.tsx"));
const MilestonesPage = React.lazy(() => import("./pages/client/MilestonesPage.tsx"));
const ActivityLogPage = React.lazy(() => import("./pages/client/ActivityLogPage.tsx"));
const SLAPage = React.lazy(() => import("./pages/client/SLAPage.tsx"));
const TeamMembersPage = React.lazy(() => import("./pages/client/TeamMembersPage.tsx"));
const ClientReportsPage = React.lazy(() => import("./pages/client/ReportsPage.tsx"));
const TaskBoardPage = React.lazy(() => import("./pages/client/TaskBoardPage.tsx"));
const ProjectsPage = React.lazy(() => import("./pages/client/ProjectsPage.tsx"));
const ContractsPage = React.lazy(() => import("./pages/client/ContractsPage.tsx"));
const SupportPage = React.lazy(() => import("./pages/client/SupportPage.tsx"));
const ProjectManagementTicketsPage = React.lazy(() => import("./pages/client/ProjectManagementTicketsPage.tsx"));
const SolutionArchitecturePage = React.lazy(() => import("./pages/client/SolutionArchitecturePage.tsx"));
const ChangeManagementPage = React.lazy(() => import("./pages/client/ChangeManagementPage.tsx"));


const MajorIncidentsPage = React.lazy(() => import("./pages/client/MajorIncidentsPage.tsx"));
const PlaybooksPage = React.lazy(() => import("./pages/client/PlaybooksPage.tsx"));
const BusinessProcessesPage = React.lazy(() => import("./pages/client/BusinessProcessesPage.tsx"));
const ProblemManagementPage = React.lazy(() => import("./pages/client/ProblemManagementPage.tsx"));
const ClientVMwareSettingsPage = React.lazy(() => import("./pages/client/VMwareSettingsPage.tsx"));
const VMwarePricingPage = React.lazy(() => import("./pages/client/VMwarePricingPage.tsx"));
const VMwareConsolePage = React.lazy(() => import("./pages/client/VMwareConsolePage.tsx"));
const SatisfactionPage = React.lazy(() => import("./pages/client/SatisfactionPage.tsx"));

// Admin pages
const AdminDashboard = React.lazy(() => import("./pages/admin/AdminDashboard.tsx"));
const UsersPage = React.lazy(() => import("./pages/admin/UsersPage.tsx"));
const TicketKanbanPage = React.lazy(() => import("./pages/admin/TicketKanbanPage.tsx"));
const ConsultantApprovalsPage = React.lazy(() => import("./pages/admin/ConsultantApprovalsPage.tsx"));
const AnalyticsPage = React.lazy(() => import("./pages/admin/AnalyticsPage.tsx"));
const AdminIntegrationsPage = React.lazy(() => import("./pages/admin/AdminIntegrationsPage.tsx"));
const EnvironmentsPage = React.lazy(() => import("./pages/admin/EnvironmentsPage.tsx"));
const EnvironmentLogsPage = React.lazy(() => import("./pages/admin/EnvironmentLogsPage.tsx"));
const MeetingJoinEventsExportPage = React.lazy(() => import("./pages/admin/MeetingJoinEventsExportPage.tsx"));
const AdminSettingsPage = React.lazy(() => import("./pages/admin/AdminSettingsPage.tsx"));
const NDAManagementPage = React.lazy(() => import("./pages/admin/NDAManagementPage.tsx"));
const InterviewTrainingPage = React.lazy(() => import("./pages/admin/InterviewTrainingPage.tsx"));
const QuestionLibraryPage = React.lazy(() => import("./pages/admin/QuestionLibraryPage.tsx"));
const InterviewTemplatesPage = React.lazy(() => import("./pages/admin/InterviewTemplatesPage.tsx"));
const ConsultantInterviewsPage = React.lazy(() => import("./pages/admin/ConsultantInterviewsPage.tsx"));
const OnCallSchedulePage = React.lazy(() => import("./pages/admin/OnCallSchedulePage.tsx"));
const LandingEditorPage = React.lazy(() => import("./pages/admin/LandingEditorPage.tsx"));
const AdminConsolePage = React.lazy(() => import("./pages/admin/AdminConsolePage.tsx"));
const AdminVMwareSettingsPage = React.lazy(() => import("./pages/admin/VMwareSettingsPage.tsx"));
const AdminErrorsPage = React.lazy(() => import("./pages/admin/AdminErrorsPage.tsx"));
const AdminPaymentsPage = React.lazy(() => import("./pages/admin/PaymentsAdminPage.tsx"));
const AdminKnowledgeReviewPage = React.lazy(() => import("./pages/admin/KnowledgeReviewPage.tsx"));

// Super admin pages
const SuperAdminOverview = React.lazy(() => import("./pages/superadmin/SuperAdminOverview.tsx"));
const RolesAuthPage = React.lazy(() => import("./pages/superadmin/RolesAuthPage.tsx"));
const UserManagementPage = React.lazy(() => import("./pages/superadmin/UserManagementPage.tsx"));
const ReportsPage = React.lazy(() => import("./pages/superadmin/ReportsPage.tsx"));
const ConfigPage = React.lazy(() => import("./pages/superadmin/ConfigPage.tsx"));
const WorkflowsPage = React.lazy(() => import("./pages/superadmin/WorkflowsPage.tsx"));
const AuditLogsPage = React.lazy(() => import("./pages/superadmin/AuditLogsPage.tsx"));
const SystemHealthPage = React.lazy(() => import("./pages/superadmin/SystemHealthPage.tsx"));
const ExecutiveDashboardPage = React.lazy(() => import("./pages/superadmin/ExecutiveDashboardPage.tsx"));

// Shared pages
const ChatSessionPage = React.lazy(() => import("./pages/chat/ChatSessionPage.tsx"));
const LiveInterviewPage = React.lazy(() => import("./pages/interview/LiveInterviewPage.tsx"));
const InterviewRespondPage = React.lazy(() => import("./pages/interview/InterviewRespondPage.tsx"));
const NotificationsPage = React.lazy(() => import("./pages/notifications/NotificationsPage.tsx"));
const ReferralsPage = React.lazy(() => import("./pages/ReferralsPage.tsx"));
const MatchRequestPopup = React.lazy(() => import("./components/consultant/MatchRequestPopup.tsx"));

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => logger.error('Query failed', error),
  }),
  mutationCache: new MutationCache({
    onError: (error) => logger.error('Mutation failed', error),
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      gcTime: 1000 * 60 * 10,
      retry: (failureCount, error) => {
        if (error instanceof Error && (error.message.includes('403') || error.message.includes('404'))) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});

const PageLoader = () => (
  <div className="min-h-[50vh] flex items-center justify-center" role="status" aria-live="polite" aria-label="Loading page">
    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
    <span className="sr-only">Loading…</span>
  </div>
);

const RTLSync = () => {
  const { i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);
  return null;
};

// Mounted inside QueryClientProvider so the hook can access the client.
import { useRealtimeStatusSync } from '@/hooks/useRealtimeStatusSync';
const RealtimeStatusSync = () => {
  useRealtimeStatusSync();
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    {import.meta.env.DEV && (
      <Suspense fallback={null}>
      </Suspense>
    )}
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HelmetProvider>
      <BrowserRouter>
        <GuestModeProvider>
        <CurrencyProvider>
        <TenantProvider>
          <RTLSync />
          <RealtimeStatusSync />
          <a href="#main-content" className="skip-to-main">Skip to main content</a>
          <ScrollToTop />
          <RouteSeo />
          <Watermark />
          <GlobalSearch />
          <MaintenanceBanner />
          <GuestBanner />
          <AIChatbot />
          <WhatsAppButton />
          <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/join/:sessionId" element={<MeetingHandoffPage />} />
            <Route path="/index" element={<Navigate to="/" replace />} />
            <Route path="/pricing" element={<PricingPage />} />
            {['privacy-policy', 'terms-and-conditions', 'refund-policy', 'subscription-and-cancellation', 'service-delivery', 'cookie-policy', 'acceptable-use'].map((slug) => (
              <Route key={slug} path={`/${slug}`} element={<LegalPage slug={slug} />} />
            ))}
            <Route path="/services/s4hana-support" element={<ServiceModulePage moduleSlug="s4hana-support" />} />
            <Route path="/services/btp-support" element={<ServiceModulePage moduleSlug="btp-support" />} />
            <Route path="/demo/confirmation/:token" element={<DemoRequestConfirmationPage />} />
            <Route path="/interview/respond/:token" element={<InterviewRespondPage />} />
            <Route path="/unsubscribe" element={<UnsubscribePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsentPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            {import.meta.env.MODE !== 'production' && (
              <Route path="/dev/verification-timeline" element={<VerificationTimelineHarness />} />
            )}
            <Route path="/consultant" element={<ProtectedRoute requiredRole="consultant"><ErrorBoundary><ConsultantLayout /></ErrorBoundary></ProtectedRoute>}>
              <Route index element={<ConsultantDashboard />} />
              <Route path="cases" element={<CasesPage />} />
              <Route path="cases/:caseId" element={<CaseDetailPage />} />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="earnings" element={<EarningsPage />} />
              <Route path="verification" element={<VerificationPage />} />
              <Route path="interviews" element={<InterviewsPage />} />
              <Route path="credits" element={<CreditsRulesPage />} />
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
              <Route path="business-processes" element={<ConsultantBusinessProcessesPage />} />
              <Route path="satisfaction" element={<SatisfactionPage />} />
            </Route>
            <Route path="/client/companies" element={<ProtectedRoute requiredRole="client"><CompanySelectorPage /></ProtectedRoute>} />
            <Route path="/client" element={<ProtectedRoute requiredRole="client"><ErrorBoundary><ClientLayout /></ErrorBoundary></ProtectedRoute>}>
              <Route index element={<ClientDashboard />} />
              <Route path="timeline" element={<TimelinePage />} />
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
              <Route path="vmware-pricing" element={<VMwarePricingPage />} />
              <Route path="vmware-console" element={<VMwareConsolePage />} />
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
              
              
              <Route path="major-incidents" element={<MajorIncidentsPage />} />
              <Route path="playbooks" element={<PlaybooksPage />} />
              <Route path="business-processes" element={<BusinessProcessesPage />} />
              <Route path="problems" element={<ProblemManagementPage />} />
              <Route path="satisfaction" element={<SatisfactionPage />} />
            </Route>
            <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><ErrorBoundary><AdminLayout /></ErrorBoundary></ProtectedRoute>}>
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
                <Route path="analytics" element={<AnalyticsConsoleSection />} />
                <Route path="vmware" element={<VMwareSettingsConsoleSection />} />
                <Route path="environment-logs" element={<EnvironmentLogsConsoleSection />} />
                <Route path="meeting-events" element={<MeetingEventsConsoleSection />} />
                <Route path="interview-training" element={<InterviewTrainingConsoleSection />} />
                <Route path="oncall" element={<OnCallScheduleConsoleSection />} />
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
              <Route path="meeting-join-events" element={<MeetingJoinEventsExportPage />} />
              <Route path="settings" element={<AdminSettingsPage />} />
              <Route path="nda-management" element={<NDAManagementPage />} />
              <Route path="landing-editor" element={<LandingEditorPage />} />
              <Route path="interview-training" element={<InterviewTrainingPage />} />
              <Route path="question-library" element={<QuestionLibraryPage />} />
              <Route path="interview-templates" element={<InterviewTemplatesPage />} />
              <Route path="consultant-interviews" element={<ConsultantInterviewsPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="oncall" element={<OnCallSchedulePage />} />
              <Route path="errors" element={<AdminErrorsPage />} />
              <Route path="payments" element={<AdminPaymentsPage />} />
              <Route path="knowledge-review" element={<AdminKnowledgeReviewPage />} />
            </Route>
            <Route path="/super-admin" element={<ProtectedRoute requiredRole="super-admin"><ErrorBoundary><SuperAdminLayout /></ErrorBoundary></ProtectedRoute>}>
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
            <Route path="/interview/live/:id" element={<ProtectedRoute><ErrorBoundary><LiveInterviewPage /></ErrorBoundary></ProtectedRoute>} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </ErrorBoundary>
        </TenantProvider>
        </CurrencyProvider>
        </GuestModeProvider>
      </BrowserRouter>
      </HelmetProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
