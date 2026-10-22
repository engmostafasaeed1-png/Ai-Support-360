import React, { Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DirectionProvider } from '@radix-ui/react-direction';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { reportQueryFailure } from '@/lib/queryErrorReporting';
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GuestModeProvider } from "./contexts/GuestModeContext.tsx";
import { CurrencyProvider } from "./contexts/CurrencyContext.tsx";
import { TenantProvider } from "./contexts/TenantContext.tsx";
import MaintenanceGate from "./components/MaintenanceGate.tsx";
import ScrollToTop from "./components/ScrollToTop.tsx";
import { ReferralCapture, ReferralJoinRedirect } from "./components/referral/ReferralCapture.tsx";
import RouteSeo from "./components/RouteSeo";
import UiTranslator from "./components/UiTranslator";
import { HelmetProvider } from "react-helmet-async";
const GlobalSearch = lazyWithRetry(() => import("./components/GlobalSearch.tsx"), 'GlobalSearch');
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import SilentErrorBoundary from "./components/SilentErrorBoundary.tsx";
import SignupErrorBoundary from "./components/auth/SignupErrorBoundary.tsx";
import { Loader2 } from 'lucide-react';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

import ProtectedRoute from "./components/auth/ProtectedRoute.tsx";
import PublicLayout from "./components/layout/PublicLayout.tsx";
import { DemoWizardProvider } from "./components/landing/DemoWizardContext";

// Portal layouts are separate downloads: a visitor on the public site never fetches the consultant, client or admin code.
const ConsultantLayout = lazyWithRetry(() => import("./components/consultant/ConsultantLayout.tsx"), 'ConsultantLayout');
const ClientLayout = lazyWithRetry(() => import("./components/client/ClientLayout.tsx"), 'ClientLayout');
const AdminLayout = lazyWithRetry(() => import("./components/admin/AdminLayout.tsx"), 'AdminLayout');
const SuperAdminLayout = lazyWithRetry(() => import("./components/superadmin/SuperAdminLayout.tsx"), 'SuperAdminLayout');
const ApprovalGate = lazyWithRetry(() => import("./components/client/ApprovalGate.tsx"), 'ApprovalGate');
const AIChatbot = lazyWithRetry(() => import("./components/chatbot/AIChatbot.tsx"), 'AIChatbot');
// Both render nothing until their own check finishes, so loading them separately changes nothing on screen.
const MaintenanceBanner = lazyWithRetry(() => import("./components/MaintenanceBanner.tsx"), 'MaintenanceBanner');
const Watermark = lazyWithRetry(() => import("./components/Watermark.tsx"), 'Watermark');
const WhatsAppButton = lazyWithRetry(() => import("./components/WhatsAppButton.tsx"), 'WhatsAppButton');
const BackToTop = lazyWithRetry(() => import("./components/common/BackToTop.tsx"), 'BackToTop');
const FeedbackHost = lazyWithRetry(() => import("./components/feedback/FeedbackHost.tsx"), 'FeedbackHost');
const MyFeedbackPage = lazyWithRetry(() => import("./pages/MyFeedbackPage.tsx"), 'MyFeedbackPage');
const FeedbackAdminPage = lazyWithRetry(() => import("./pages/admin/FeedbackAdminPage.tsx"), 'FeedbackAdminPage');

// Admin console sections (one download per section file, only for administrators)
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType<any>>>, key: K) =>
  lazyWithRetry(() => load().then((m) => ({ default: m[key] })), key);
const OverviewSection = lazyWithRetry(() => import("./components/admin/console/sections/OverviewSection.tsx"), 'OverviewSection');
const UserManagementSection = lazyWithRetry(() => import("./components/admin/console/sections/UserManagementSection.tsx"), 'UserManagementSection');
const RolesPermissionsSection = lazyWithRetry(() => import("./components/admin/console/sections/RolesPermissionsSection.tsx"), 'RolesPermissionsSection');
const SubscriptionsSection = lazyWithRetry(() => import("./components/admin/console/sections/SubscriptionsSection.tsx"), 'SubscriptionsSection');
const InvoiceNumberingSection = lazyWithRetry(() => import("./components/admin/console/sections/InvoiceNumberingSection.tsx"), 'InvoiceNumberingSection');
const securitySections = () => import("./components/admin/console/sections/SecuritySections.tsx");
const SecuritySettingsSection = named(securitySections, 'SecuritySettingsSection');
const AuthenticationSection = named(securitySections, 'AuthenticationSection');
const DataAccessSection = named(securitySections, 'DataAccessSection');
const AuditLogSection = named(securitySections, 'AuditLogSection');
const operationsSections = () => import("./components/admin/console/sections/OperationsSections.tsx");
const TicketManagementSection = named(operationsSections, 'TicketManagementSection');
const ConsultantApprovalsSection = named(operationsSections, 'ConsultantApprovalsSection');
const NDAManagementSection = named(operationsSections, 'NDAManagementSection');
const MatchRequestsSection = named(operationsSections, 'MatchRequestsSection');
const ProjectsMilestonesSection = named(operationsSections, 'ProjectsMilestonesSection');
const systemSections = () => import("./components/admin/console/sections/SystemSections.tsx");
const NotificationsSection = named(systemSections, 'NotificationsSection');
const LocalizationSection = named(systemSections, 'LocalizationSection');
const AppearanceSection = named(systemSections, 'AppearanceSection');
const StorageSection = named(systemSections, 'StorageSection');
const EmailSection = named(systemSections, 'EmailSection');
const AdminIntSection = named(systemSections, 'IntegrationsSection');
const EnvironmentsSection = named(systemSections, 'EnvironmentsSection');
const LandingEditorSection = named(systemSections, 'LandingEditorSection');
const PlatformSettingsSection = named(systemSections, 'PlatformSettingsSection');
const MaintenanceSection = named(systemSections, 'MaintenanceSection');
const additionalSections = () => import("./components/admin/console/sections/AdditionalSections.tsx");
const AnalyticsConsoleSection = named(additionalSections, 'AnalyticsConsoleSection');
const VMwareSettingsConsoleSection = named(additionalSections, 'VMwareSettingsConsoleSection');
const EnvironmentLogsConsoleSection = named(additionalSections, 'EnvironmentLogsConsoleSection');
const MeetingEventsConsoleSection = named(additionalSections, 'MeetingEventsConsoleSection');
const InterviewTrainingConsoleSection = named(additionalSections, 'InterviewTrainingConsoleSection');
const OnCallScheduleConsoleSection = named(additionalSections, 'OnCallScheduleConsoleSection');

// Lazy page imports
const Index = lazyWithRetry(() => import("./pages/Index.tsx"), 'Index');
const NotFound = lazyWithRetry(() => import("./pages/NotFound.tsx"), 'NotFound');
const MeetingHandoffPage = lazyWithRetry(() => import("./pages/MeetingHandoffPage.tsx"), 'MeetingHandoffPage');
const PricingPage = lazyWithRetry(() => import("./pages/PricingPage.tsx"), 'PricingPage');
const ForConsultantsPage = lazyWithRetry(() => import("./pages/ForConsultantsPage.tsx"), 'ForConsultantsPage');
const LegalPage = lazyWithRetry(() => import("./pages/LegalPage.tsx"), 'LegalPage');
const ServiceModulePage = lazyWithRetry(() => import("./pages/ServiceModulePage.tsx"), 'ServiceModulePage');
const DemoRequestConfirmationPage = lazyWithRetry(() => import("./pages/DemoRequestConfirmationPage.tsx"), 'DemoRequestConfirmationPage');
const UnsubscribePage = lazyWithRetry(() => import("./pages/UnsubscribePage.tsx"), 'UnsubscribePage');
const NotificationPausePage = lazyWithRetry(() => import("./pages/NotificationPausePage.tsx"), 'NotificationPausePage');
const LoginPage = lazyWithRetry(() => import("./pages/auth/LoginPage.tsx"), 'LoginPage');
const OAuthConsentPage = lazyWithRetry(() => import("./pages/auth/OAuthConsentPage.tsx"), 'OAuthConsentPage');
const SignupPage = lazyWithRetry(() => import("./pages/auth/SignupPage.tsx"), 'SignupPage');
const ForgotPasswordPage = lazyWithRetry(() => import("./pages/auth/ForgotPasswordPage.tsx"), 'ForgotPasswordPage');
const VerificationTimelineHarness = lazyWithRetry(
  () => import("./pages/dev/VerificationTimelineHarness.tsx"),
  'VerificationTimelineHarness',
);
const ResetPasswordPage = lazyWithRetry(() => import("./pages/auth/ResetPasswordPage.tsx"), 'ResetPasswordPage');
const ConfirmEmailPage = lazyWithRetry(() => import("./pages/auth/ConfirmEmailPage.tsx"), 'ConfirmEmailPage');

// Consultant pages
const ConsultantDashboard = lazyWithRetry(() => import("./pages/consultant/ConsultantDashboard.tsx"), 'ConsultantDashboard');
const CasesPage = lazyWithRetry(() => import("./pages/consultant/CasesPage.tsx"), 'CasesPage');
const CaseDetailPage = lazyWithRetry(() => import("./pages/consultant/CaseDetailPage.tsx"), 'CaseDetailPage');
const RequestsPage = lazyWithRetry(() => import("./pages/consultant/RequestsPage.tsx"), 'RequestsPage');
const ResponsivenessPage = lazyWithRetry(() => import("./pages/consultant/ResponsivenessPage.tsx"), 'ResponsivenessPage');
const ResponsivenessAdminPage = lazyWithRetry(() => import("./pages/admin/ResponsivenessAdminPage.tsx"), 'ResponsivenessAdminPage');
const ReferralsAdminPage = lazyWithRetry(() => import("./pages/admin/ReferralsAdminPage.tsx"), 'ReferralsAdminPage');
const ReferAndEarnPage = lazyWithRetry(() => import("./pages/consultant/ReferAndEarnPage.tsx"), 'ReferAndEarnPage');
const ReferralTermsPage = lazyWithRetry(() => import("./pages/ReferralTermsPage.tsx"), 'ReferralTermsPage');
const ProposalsPage = lazyWithRetry(() => import("./pages/consultant/ProposalsPage.tsx"), 'ProposalsPage');
const OpenTicketsPage = lazyWithRetry(() => import("./pages/consultant/OpenTicketsPage.tsx"), 'OpenTicketsPage');
const WorkDiaryPage = lazyWithRetry(() => import("./pages/consultant/WorkDiaryPage.tsx"), 'WorkDiaryPage');
const CalendarPage = lazyWithRetry(() => import("./pages/consultant/CalendarPage.tsx"), 'CalendarPage');
const EarningsPage = lazyWithRetry(() => import("./pages/consultant/ConsultantEarningsPage.tsx"), 'EarningsPage');
const VerificationPage = lazyWithRetry(() => import("./pages/consultant/VerificationPage.tsx"), 'VerificationPage');
const ProfilePage = lazyWithRetry(() => import("./pages/consultant/ProfilePage.tsx"), 'ProfilePage');
const OnboardingPage = lazyWithRetry(() => import("./pages/consultant/OnboardingPage.tsx"), 'OnboardingPage');
const InterviewsPage = lazyWithRetry(() => import("./pages/consultant/InterviewsPage.tsx"), 'InterviewsPage');
const ConsultantChatPage = lazyWithRetry(() => import("./pages/consultant/ConsultantChatPage.tsx"), 'ConsultantChatPage');
const RemoteAccessPage = lazyWithRetry(() => import("./pages/consultant/RemoteAccessPage.tsx"), 'RemoteAccessPage');
const ReviewsPage = lazyWithRetry(() => import("./pages/consultant/ReviewsPage.tsx"), 'ReviewsPage');
const ConsultantSettingsPage = lazyWithRetry(() => import("./pages/consultant/SettingsPage.tsx"), 'ConsultantSettingsPage');
const ConsultantKnowledgePage = lazyWithRetry(() => import("./pages/consultant/KnowledgePage.tsx"), 'ConsultantKnowledgePage');
const ConsultantReportsPage = lazyWithRetry(() => import("./pages/consultant/ReportsPage.tsx"), 'ConsultantReportsPage');
const ConsultantBusinessProcessesPage = lazyWithRetry(() => import("./pages/consultant/BusinessProcessesPage.tsx"), 'ConsultantBusinessProcessesPage');
const CreditsRulesPage = lazyWithRetry(() => import("./pages/consultant/CreditsRulesPage.tsx"), 'CreditsRulesPage');

// Client pages
const ClientDashboard = lazyWithRetry(() => import("./pages/client/ClientDashboard.tsx"), 'ClientDashboard');
const TimelinePage = lazyWithRetry(() => import("./pages/client/TimelinePage.tsx"), 'TimelinePage');
const NewRequestPage = lazyWithRetry(() => import("./pages/client/NewRequestPage.tsx"), 'NewRequestPage');
const TicketsPage = lazyWithRetry(() => import("./pages/client/TicketsPage.tsx"), 'TicketsPage');
const TicketDetailPage = lazyWithRetry(() => import("./pages/client/TicketDetailPage.tsx"), 'TicketDetailPage');
const ConsultantsPage = lazyWithRetry(() => import("./pages/client/ConsultantsPage.tsx"), 'ConsultantsPage');
const MyConsultantsPage = lazyWithRetry(() => import("./pages/client/MyConsultantsPage.tsx"), 'MyConsultantsPage');
const ConsultantResponsivenessPage = lazyWithRetry(() => import("./pages/client/ConsultantResponsivenessPage.tsx"), 'ConsultantResponsivenessPage');
const ConsultantProfilePage = lazyWithRetry(() => import("./pages/client/ConsultantProfilePage.tsx"), 'ConsultantProfilePage');
const PaymentsPage = lazyWithRetry(() => import("./pages/client/PaymentsPage.tsx"), 'PaymentsPage');
const ClientChatPage = lazyWithRetry(() => import("./pages/client/ClientChatPage.tsx"), 'ClientChatPage');
const ClientOnboardingPage = lazyWithRetry(() => import("./pages/client/ClientOnboardingPage.tsx"), 'ClientOnboardingPage');
const SessionsPage = lazyWithRetry(() => import("./pages/client/SessionsPage.tsx"), 'SessionsPage');
const VideoSessionsPage = lazyWithRetry(() => import("./pages/client/VideoSessionsPage.tsx"), 'VideoSessionsPage');
const SessionDetailPage = lazyWithRetry(() => import("./pages/client/SessionDetailPage.tsx"), 'SessionDetailPage');
const SettingsPage = lazyWithRetry(() => import("./pages/client/SettingsPage.tsx"), 'SettingsPage');
const IntegrationsPage = lazyWithRetry(() => import("./pages/client/IntegrationsPage.tsx"), 'IntegrationsPage');
const CompanyProfilePage = lazyWithRetry(() => import("./pages/client/CompanyProfilePage.tsx"), 'CompanyProfilePage');
const CompanySelectorPage = lazyWithRetry(() => import("./pages/client/CompanySelectorPage.tsx"), 'CompanySelectorPage');
const ClientRemoteAccessPage = lazyWithRetry(() => import("./pages/client/RemoteAccessPage.tsx"), 'ClientRemoteAccessPage');
const InvoicesPage = lazyWithRetry(() => import("./pages/client/InvoicesPage.tsx"), 'InvoicesPage');
const KnowledgePage = lazyWithRetry(() => import("./pages/client/KnowledgePage.tsx"), 'KnowledgePage');
const MilestonesPage = lazyWithRetry(() => import("./pages/client/MilestonesPage.tsx"), 'MilestonesPage');
const ActivityLogPage = lazyWithRetry(() => import("./pages/client/ActivityLogPage.tsx"), 'ActivityLogPage');
const SLAPage = lazyWithRetry(() => import("./pages/client/SLAPage.tsx"), 'SLAPage');
const TeamMembersPage = lazyWithRetry(() => import("./pages/client/TeamMembersPage.tsx"), 'TeamMembersPage');
const ClientReportsPage = lazyWithRetry(() => import("./pages/client/ReportsPage.tsx"), 'ClientReportsPage');
const TaskBoardPage = lazyWithRetry(() => import("./pages/client/TaskBoardPage.tsx"), 'TaskBoardPage');
const ProjectsPage = lazyWithRetry(() => import("./pages/client/ProjectsPage.tsx"), 'ProjectsPage');
const ContractsPage = lazyWithRetry(() => import("./pages/client/ContractsPage.tsx"), 'ContractsPage');
const SupportPage = lazyWithRetry(() => import("./pages/client/SupportPage.tsx"), 'SupportPage');
const ProjectManagementTicketsPage = lazyWithRetry(() => import("./pages/client/ProjectManagementTicketsPage.tsx"), 'ProjectManagementTicketsPage');
const SolutionArchitecturePage = lazyWithRetry(() => import("./pages/client/SolutionArchitecturePage.tsx"), 'SolutionArchitecturePage');
const ChangeManagementPage = lazyWithRetry(() => import("./pages/client/ChangeManagementPage.tsx"), 'ChangeManagementPage');


const MajorIncidentsPage = lazyWithRetry(() => import("./pages/client/MajorIncidentsPage.tsx"), 'MajorIncidentsPage');
const PlaybooksPage = lazyWithRetry(() => import("./pages/client/PlaybooksPage.tsx"), 'PlaybooksPage');
const BusinessProcessesPage = lazyWithRetry(() => import("./pages/client/BusinessProcessesPage.tsx"), 'BusinessProcessesPage');
const ProblemManagementPage = lazyWithRetry(() => import("./pages/client/ProblemManagementPage.tsx"), 'ProblemManagementPage');
const ClientVMwareSettingsPage = lazyWithRetry(() => import("./pages/client/VMwareSettingsPage.tsx"), 'ClientVMwareSettingsPage');
const VMwarePricingPage = lazyWithRetry(() => import("./pages/client/VMwarePricingPage.tsx"), 'VMwarePricingPage');
const VMwareConsolePage = lazyWithRetry(() => import("./pages/client/VMwareConsolePage.tsx"), 'VMwareConsolePage');
const SatisfactionPage = lazyWithRetry(() => import("./pages/client/SatisfactionPage.tsx"), 'SatisfactionPage');

// Admin pages
const AdminDashboard = lazyWithRetry(() => import("./pages/admin/AdminDashboard.tsx"), 'AdminDashboard');
const UsersPage = lazyWithRetry(() => import("./pages/admin/UsersPage.tsx"), 'UsersPage');
const TicketKanbanPage = lazyWithRetry(() => import("./pages/admin/TicketKanbanPage.tsx"), 'TicketKanbanPage');
const ConsultantApprovalsPage = lazyWithRetry(() => import("./pages/admin/ConsultantApprovalsPage.tsx"), 'ConsultantApprovalsPage');
const AnalyticsPage = lazyWithRetry(() => import("./pages/admin/AnalyticsPage.tsx"), 'AnalyticsPage');
const AdminIntegrationsPage = lazyWithRetry(() => import("./pages/admin/AdminIntegrationsPage.tsx"), 'AdminIntegrationsPage');
const EnvironmentsPage = lazyWithRetry(() => import("./pages/admin/EnvironmentsPage.tsx"), 'EnvironmentsPage');
const EnvironmentLogsPage = lazyWithRetry(() => import("./pages/admin/EnvironmentLogsPage.tsx"), 'EnvironmentLogsPage');
const MeetingJoinEventsExportPage = lazyWithRetry(() => import("./pages/admin/MeetingJoinEventsExportPage.tsx"), 'MeetingJoinEventsExportPage');
const AdminSettingsPage = lazyWithRetry(() => import("./pages/admin/AdminSettingsPage.tsx"), 'AdminSettingsPage');
const NDAManagementPage = lazyWithRetry(() => import("./pages/admin/NDAManagementPage.tsx"), 'NDAManagementPage');
const InterviewTrainingPage = lazyWithRetry(() => import("./pages/admin/InterviewTrainingPage.tsx"), 'InterviewTrainingPage');
const QuestionLibraryPage = lazyWithRetry(() => import("./pages/admin/QuestionLibraryPage.tsx"), 'QuestionLibraryPage');
const InterviewTemplatesPage = lazyWithRetry(() => import("./pages/admin/InterviewTemplatesPage.tsx"), 'InterviewTemplatesPage');
const ConsultantInterviewsPage = lazyWithRetry(() => import("./pages/admin/ConsultantInterviewsPage.tsx"), 'ConsultantInterviewsPage');
const OnCallSchedulePage = lazyWithRetry(() => import("./pages/admin/OnCallSchedulePage.tsx"), 'OnCallSchedulePage');
const LandingEditorPage = lazyWithRetry(() => import("./pages/admin/LandingEditorPage.tsx"), 'LandingEditorPage');
const AdminConsolePage = lazyWithRetry(() => import("./pages/admin/AdminConsolePage.tsx"), 'AdminConsolePage');
const AdminVMwareSettingsPage = lazyWithRetry(() => import("./pages/admin/VMwareSettingsPage.tsx"), 'AdminVMwareSettingsPage');
const AdminErrorsPage = lazyWithRetry(() => import("./pages/admin/AdminErrorsPage.tsx"), 'AdminErrorsPage');
const AdminPaymentsPage = lazyWithRetry(() => import("./pages/admin/PaymentsAdminPage.tsx"), 'AdminPaymentsPage');
const AdminKnowledgeReviewPage = lazyWithRetry(() => import("./pages/admin/KnowledgeReviewPage.tsx"), 'AdminKnowledgeReviewPage');
const ProfileFieldsSection = lazyWithRetry(() => import("./components/admin/console/sections/ProfileFieldsSection.tsx"), 'ProfileFieldsSection');
const ConsultantPolicySection = lazyWithRetry(() => import("./components/admin/console/sections/ConsultantPolicySection.tsx"), 'ConsultantPolicySection');
const ConsultantPolicyPage = lazyWithRetry(() => import("./pages/ConsultantPolicyPage.tsx"), 'ConsultantPolicyPage');
const MissingLocationSection = lazyWithRetry(() => import("./components/admin/console/sections/MissingLocationSection.tsx"), 'MissingLocationSection');
const AvailabilityAdminSection = lazyWithRetry(() => import("./components/admin/console/sections/AvailabilityAdminSection.tsx"), 'AvailabilityAdminSection');
const VMwarePricingSection = lazyWithRetry(() => import("./components/admin/console/sections/VMwarePricingSection.tsx"), 'VMwarePricingSection');
const AdminClientApprovalsPage = lazyWithRetry(() => import("./pages/admin/ClientApprovalsPage.tsx"), 'AdminClientApprovalsPage');
const AdminClientReviewsPage = lazyWithRetry(() => import("./pages/admin/ClientReviewsPage.tsx"), 'AdminClientReviewsPage');
const AdminDemoRequestsPage = lazyWithRetry(() => import("./pages/admin/DemoRequestsPage.tsx"), 'AdminDemoRequestsPage');

// Super admin pages
const SuperAdminOverview = lazyWithRetry(() => import("./pages/superadmin/SuperAdminOverview.tsx"), 'SuperAdminOverview');
const RolesAuthPage = lazyWithRetry(() => import("./pages/superadmin/RolesAuthPage.tsx"), 'RolesAuthPage');
const UserManagementPage = lazyWithRetry(() => import("./pages/superadmin/UserManagementPage.tsx"), 'UserManagementPage');
const ReportsPage = lazyWithRetry(() => import("./pages/superadmin/ReportsPage.tsx"), 'ReportsPage');
const ConfigPage = lazyWithRetry(() => import("./pages/superadmin/ConfigPage.tsx"), 'ConfigPage');
const WorkflowsPage = lazyWithRetry(() => import("./pages/superadmin/WorkflowsPage.tsx"), 'WorkflowsPage');
const AuditLogsPage = lazyWithRetry(() => import("./pages/superadmin/AuditLogsPage.tsx"), 'AuditLogsPage');
const SystemHealthPage = lazyWithRetry(() => import("./pages/superadmin/SystemHealthPage.tsx"), 'SystemHealthPage');
const ExecutiveDashboardPage = lazyWithRetry(() => import("./pages/superadmin/ExecutiveDashboardPage.tsx"), 'ExecutiveDashboardPage');

// Shared pages
const ChatSessionPage = lazyWithRetry(() => import("./pages/chat/ChatSessionPage.tsx"), 'ChatSessionPage');
const LiveInterviewPage = lazyWithRetry(() => import("./pages/interview/LiveInterviewPage.tsx"), 'LiveInterviewPage');
const InterviewRespondPage = lazyWithRetry(() => import("./pages/interview/InterviewRespondPage.tsx"), 'InterviewRespondPage');
const NotificationsPage = lazyWithRetry(() => import("./pages/notifications/NotificationsPage.tsx"), 'NotificationsPage');
const NotificationsRedirect = lazyWithRetry(() => import("./pages/NotificationsRedirect.tsx"), 'NotificationsRedirect');
const MessagesPage = lazyWithRetry(() => import("./pages/admin/MessagesPage.tsx"), 'MessagesPage');
const ReferralsPage = lazyWithRetry(() => import("./pages/ReferralsPage.tsx"), 'ReferralsPage');
const InvoiceDocumentPage = lazyWithRetry(() => import("./pages/InvoiceDocumentPage.tsx"), 'InvoiceDocumentPage');
const MatchRequestPopup = lazyWithRetry(() => import("./components/consultant/MatchRequestPopup.tsx"), 'MatchRequestPopup');

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => reportQueryFailure('Query failed', error, query.queryKey),
  }),
  mutationCache: new MutationCache({
    onError: (error) => reportQueryFailure('Mutation failed', error),
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

// Radix components (tabs, menus, selects, sliders) read their direction from this provider; without it they stay left-to-right inside the Arabic layout.
const RadixDirection = ({ children }: { children: React.ReactNode }) => {
  const { i18n } = useTranslation();
  return <DirectionProvider dir={i18n.language?.startsWith('ar') ? 'rtl' : 'ltr'}>{children}</DirectionProvider>;
};

const RTLSync = () => {
  const { i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);
  return null;
};

// Notices written for a consultant link to /consultant/sessions/<id>; the page of a session for a consultant is its chat page.
const ConsultantSessionRedirect = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <Navigate to={sessionId ? `/consultant/chat/${sessionId}` : '/consultant/calendar'} replace />;
};

// Mounts its children once the browser is idle after the first paint, so optional helpers do not delay the page.
const IdleMount = ({ children }: { children: React.ReactNode }) => {
  const [ready, setReady] = React.useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) { const id = w.requestIdleCallback(() => setReady(true), { timeout: 3000 }); return () => w.cancelIdleCallback?.(id); }
    const t = window.setTimeout(() => setReady(true), 1500);
    return () => window.clearTimeout(t);
  }, []);
  return ready ? <>{children}</> : null;
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
    <RadixDirection>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HelmetProvider>
      <BrowserRouter>
        <GuestModeProvider>
        <CurrencyProvider>
        <TenantProvider>
          <RTLSync />
          <UiTranslator />
          <RealtimeStatusSync />
          <a href="#main-content" className="skip-to-main">Skip to main content</a>
          <ScrollToTop />
          <SilentErrorBoundary><ReferralCapture /></SilentErrorBoundary>
          <RouteSeo />
          <Suspense fallback={null}><Watermark /></Suspense>
          <IdleMount><Suspense fallback={null}><GlobalSearch /></Suspense></IdleMount>
          <Suspense fallback={null}><MaintenanceBanner /></Suspense>
          
          <IdleMount><Suspense fallback={null}><AIChatbot /></Suspense></IdleMount>
          {/* Floating buttons load after the first paint so they stay out of the start-up download. */}
          <IdleMount><Suspense fallback={null}><WhatsAppButton /><BackToTop /><FeedbackHost /></Suspense></IdleMount>
          <ErrorBoundary>
<MaintenanceGate>
          <Suspense fallback={<PageLoader />}>
<DemoWizardProvider>
          <Routes>
            <Route path="/join" element={<ReferralJoinRedirect />} />
            <Route path="/join/:sessionId" element={<MeetingHandoffPage />} />
            <Route path="/index" element={<Navigate to="/" replace />} />
            <Route element={<PublicLayout variant="content" />}>
              <Route path="/" element={<Index />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/for-consultants" element={<ForConsultantsPage />} />
              <Route path="/consultant-policy" element={<ConsultantPolicyPage />} />
              <Route path="/referral-terms" element={<ReferralTermsPage />} />
              {['privacy-policy', 'terms-and-conditions', 'refund-policy', 'subscription-and-cancellation', 'service-delivery', 'cookie-policy', 'acceptable-use'].map((slug) => (
                <Route key={slug} path={`/${slug}`} element={<LegalPage slug={slug} />} />
              ))}
              <Route path="/services/s4hana-support" element={<ServiceModulePage moduleSlug="s4hana-support" />} />
              <Route path="/services/btp-support" element={<ServiceModulePage moduleSlug="btp-support" />} />
            </Route>
            <Route element={<PublicLayout variant="auth" />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupErrorBoundary><SignupPage /></SignupErrorBoundary>} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/auth/confirm" element={<ConfirmEmailPage />} />
            </Route>
            <Route element={<PublicLayout />}>
              <Route path="/my-feedback" element={<ProtectedRoute><MyFeedbackPage /></ProtectedRoute>} />
              <Route path="/unsubscribe" element={<UnsubscribePage />} />
              <Route path="/notifications/pause" element={<NotificationPausePage />} />
              <Route path="/demo/confirmation/:token" element={<DemoRequestConfirmationPage />} />
              <Route path="/interview/respond/:token" element={<InterviewRespondPage />} />
            </Route>
            <Route path="/notifications" element={<NotificationsRedirect />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsentPage />} />
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
              <Route path="sessions/:sessionId" element={<ConsultantSessionRedirect />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="onboarding" element={<OnboardingPage />} />
              <Route path="remote-access" element={<RemoteAccessPage />} />
              <Route path="reviews" element={<ReviewsPage />} />
              <Route path="responsiveness" element={<ResponsivenessPage />} />
              <Route path="settings" element={<ConsultantSettingsPage />} />
              <Route path="knowledge" element={<ConsultantKnowledgePage />} />
              <Route path="proposals" element={<ProposalsPage />} />
              <Route path="open-tickets" element={<OpenTicketsPage />} />
              <Route path="tickets/:ticketId" element={<TicketDetailPage />} />
              <Route path="work-diary" element={<WorkDiaryPage />} />
              <Route path="reports" element={<ConsultantReportsPage />} />
              <Route path="referrals" element={<ReferAndEarnPage />} />
              <Route path="refer" element={<ReferAndEarnPage />} />
              <Route path="business-processes" element={<ConsultantBusinessProcessesPage />} />
              <Route path="satisfaction" element={<SatisfactionPage />} />
            </Route>
            <Route path="/client/companies" element={<ProtectedRoute requiredRole="client"><CompanySelectorPage /></ProtectedRoute>} />
            <Route path="/client" element={<ProtectedRoute requiredRole="client"><ErrorBoundary><ClientLayout /></ErrorBoundary></ProtectedRoute>}>
              <Route index element={<ClientDashboard />} />
              <Route path="timeline" element={<TimelinePage />} />
              <Route path="new-request" element={<ApprovalGate><NewRequestPage /></ApprovalGate>} />
              <Route path="tickets" element={<TicketsPage />} />
              <Route path="tickets/:ticketId" element={<TicketDetailPage />} />
              <Route path="consultants" element={<ConsultantsPage />} />
              <Route path="consultants/:id" element={<ConsultantProfilePage />} />
              <Route path="responsiveness" element={<ConsultantResponsivenessPage />} />
              <Route path="my-consultants" element={<MyConsultantsPage />} />
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
              <Route index element={<AdminDashboard />} />
              <Route path="console" element={<AdminConsolePage />}>
                <Route index element={<OverviewSection />} />
                <Route path="users" element={<UserManagementSection />} />
                <Route path="roles" element={<RolesPermissionsSection />} />
<Route path="subscriptions" element={<SubscriptionsSection />} />
                <Route path="invoice-numbering" element={<InvoiceNumberingSection />} />
                <Route path="tickets" element={<TicketManagementSection />} />
                <Route path="approvals" element={<ConsultantApprovalsSection />} />
                <Route path="profile-fields" element={<ProfileFieldsSection />} />
                <Route path="missing-location" element={<MissingLocationSection />} />
                <Route path="availability" element={<AvailabilityAdminSection />} />
                <Route path="consultant-policy" element={<ConsultantPolicySection />} />
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
                <Route path="vmware-pricing" element={<VMwarePricingSection />} />
                <Route path="environment-logs" element={<EnvironmentLogsConsoleSection />} />
                <Route path="meeting-events" element={<MeetingEventsConsoleSection />} />
                <Route path="interview-training" element={<InterviewTrainingConsoleSection />} />
                <Route path="oncall" element={<OnCallScheduleConsoleSection />} />
                <Route path="*" element={<Navigate to="/admin/console" replace />} />
              </Route>
              <Route path="users" element={<UsersPage />} />
              <Route path="messages" element={<MessagesPage />} />
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
              <Route path="feedback" element={<FeedbackAdminPage />} />
              <Route path="payments" element={<AdminPaymentsPage />} />
              <Route path="responsiveness" element={<ResponsivenessAdminPage />} />
              <Route path="referrals" element={<ReferralsAdminPage />} />
              <Route path="knowledge-review" element={<AdminKnowledgeReviewPage />} />
              <Route path="client-approvals" element={<AdminClientApprovalsPage />} />
              <Route path="client-reviews" element={<AdminClientReviewsPage />} />
              <Route path="demo-requests" element={<AdminDemoRequestsPage />} />
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
            <Route path="/invoice/:paymentId" element={<ProtectedRoute><ErrorBoundary><InvoiceDocumentPage /></ErrorBoundary></ProtectedRoute>} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route element={<PublicLayout />}>
              <Route path="*" element={<NotFound />} />
            </Route>
</Routes>
          </DemoWizardProvider>
          </Suspense>
          </MaintenanceGate>
          </ErrorBoundary>
        </TenantProvider>
        </CurrencyProvider>
        </GuestModeProvider>
      </BrowserRouter>
      </HelmetProvider>
    </TooltipProvider>
    </RadixDirection>
  </QueryClientProvider>
);

export default App;
