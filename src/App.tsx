import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GuestModeProvider } from "./contexts/GuestModeContext.tsx";
import GuestBanner from "./components/guest/GuestBanner.tsx";
import AIChatbot from "./components/chatbot/AIChatbot.tsx";
import MaintenanceBanner from "./components/MaintenanceBanner.tsx";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import ConsultantLayout from "./components/consultant/ConsultantLayout.tsx";
import ConsultantDashboard from "./pages/consultant/ConsultantDashboard.tsx";
import CasesPage from "./pages/consultant/CasesPage.tsx";
import CalendarPage from "./pages/consultant/CalendarPage.tsx";
import EarningsPage from "./pages/consultant/EarningsPage.tsx";
import VerificationPage from "./pages/consultant/VerificationPage.tsx";
import ProfilePage from "./pages/consultant/ProfilePage.tsx";
import OnboardingPage from "./pages/consultant/OnboardingPage.tsx";
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
import SessionDetailPage from "./pages/client/SessionDetailPage.tsx";
import SettingsPage from "./pages/client/SettingsPage.tsx";
import IntegrationsPage from "./pages/client/IntegrationsPage.tsx";
import CompanyProfilePage from "./pages/client/CompanyProfilePage.tsx";
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

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <GuestModeProvider>
          <MaintenanceBanner />
          <GuestBanner />
          <AIChatbot />
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
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="earnings" element={<EarningsPage />} />
              <Route path="verification" element={<VerificationPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="chat" element={<ConsultantChatPage />} />
              <Route path="chat/:sessionId" element={<ChatSessionPage role="consultant" />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="onboarding" element={<OnboardingPage />} />
              <Route path="remote-access" element={<RemoteAccessPage />} />
            </Route>
            <Route path="/client" element={<ProtectedRoute requiredRole="client"><ClientLayout /></ProtectedRoute>}>
              <Route index element={<ClientDashboard />} />
              <Route path="new-request" element={<NewRequestPage />} />
              <Route path="tickets" element={<TicketsPage />} />
              <Route path="tickets/:ticketId" element={<TicketDetailPage />} />
              <Route path="consultants" element={<ConsultantsPage />} />
              <Route path="consultants/:id" element={<ConsultantProfilePage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="sessions" element={<SessionsPage />} />
              <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
              <Route path="chat" element={<ClientChatPage />} />
              <Route path="chat/:sessionId" element={<ChatSessionPage role="client" />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="company" element={<CompanyProfilePage />} />
              <Route path="integrations" element={<IntegrationsPage />} />
              <Route path="onboarding" element={<ClientOnboardingPage />} />
              <Route path="remote-access" element={<ClientRemoteAccessPage />} />
            </Route>
            <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminLayout /></ProtectedRoute>}>
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="tickets" element={<TicketKanbanPage />} />
              <Route path="approvals" element={<ConsultantApprovalsPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="integrations" element={<AdminIntegrationsPage />} />
              <Route path="environments" element={<EnvironmentsPage />} />
              <Route path="environment-logs" element={<EnvironmentLogsPage />} />
              <Route path="settings" element={<AdminSettingsPage />} />
              <Route path="nda-management" element={<NDAManagementPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </GuestModeProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
