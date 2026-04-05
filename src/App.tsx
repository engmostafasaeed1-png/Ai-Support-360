import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import ConsultantLayout from "./components/consultant/ConsultantLayout.tsx";
import ConsultantDashboard from "./pages/consultant/ConsultantDashboard.tsx";
import CasesPage from "./pages/consultant/CasesPage.tsx";
import CalendarPage from "./pages/consultant/CalendarPage.tsx";
import EarningsPage from "./pages/consultant/EarningsPage.tsx";
import VerificationPage from "./pages/consultant/VerificationPage.tsx";
import ProfilePage from "./pages/consultant/ProfilePage.tsx";
import ClientLayout from "./components/client/ClientLayout.tsx";
import ClientDashboard from "./pages/client/ClientDashboard.tsx";
import NewRequestPage from "./pages/client/NewRequestPage.tsx";
import TicketsPage from "./pages/client/TicketsPage.tsx";
import ConsultantsPage from "./pages/client/ConsultantsPage.tsx";
import PaymentsPage from "./pages/client/PaymentsPage.tsx";
import PricingPage from "./pages/PricingPage.tsx";
import AdminLayout from "./components/admin/AdminLayout.tsx";
import AdminDashboard from "./pages/admin/AdminDashboard.tsx";
import UsersPage from "./pages/admin/UsersPage.tsx";
import TicketKanbanPage from "./pages/admin/TicketKanbanPage.tsx";
import ConsultantApprovalsPage from "./pages/admin/ConsultantApprovalsPage.tsx";
import AnalyticsPage from "./pages/admin/AnalyticsPage.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/consultant" element={<ConsultantLayout />}>
            <Route index element={<ConsultantDashboard />} />
            <Route path="cases" element={<CasesPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="earnings" element={<EarningsPage />} />
            <Route path="verification" element={<VerificationPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
          <Route path="/client" element={<ClientLayout />}>
            <Route index element={<ClientDashboard />} />
            <Route path="new-request" element={<NewRequestPage />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="consultants" element={<ConsultantsPage />} />
            <Route path="payments" element={<PaymentsPage />} />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
