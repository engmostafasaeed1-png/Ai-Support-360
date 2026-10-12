// Mock data for the client portal
export const mockClientProfile = {
  id: 'cl1',
  user_id: 'u2',
  display_name: 'Khalid Al-Otaibi',
  avatar: 'KO',
  company: 'Saudi Petrochemical Corp',
  email: 'khalid@saudipetrochem.com',
  phone: '+966 50 987 6543',
};

export const mockClientTickets: Array<{
  id: string; title: string; sap_module: string; urgency: string;
  status: string; created_at: string; consultant?: string;
}> = [
  { id: 't1', title: 'S/4HANA Finance month-end close issue', sap_module: 'SAP S/4HANA', urgency: 'high', status: 'in_progress', created_at: '2026-04-03T10:00:00Z', consultant: 'Ahmed Al-Rashid' },
  { id: 't6', title: 'SuccessFactors Employee Central sync error', sap_module: 'SuccessFactors', urgency: 'medium', status: 'matched', created_at: '2026-04-04T11:00:00Z', consultant: 'Dr. Fatima Hassan' },
  { id: 't7', title: 'SD pricing condition not applying', sap_module: 'SAP SD', urgency: 'high', status: 'new', created_at: '2026-04-05T07:00:00Z' },
  { id: 't8', title: 'Basis transport stuck in queue', sap_module: 'SAP Basis', urgency: 'critical', status: 'under_review', created_at: '2026-04-05T08:30:00Z' },
  { id: 't9', title: 'FI posting period not opened', sap_module: 'SAP FI/CO', urgency: 'low', status: 'resolved', created_at: '2026-03-20T09:00:00Z', consultant: 'Ahmed Al-Rashid' },
];

export const mockClientSessions = [
  { id: 'cs1', ticket_title: 'S/4HANA Finance month-end close issue', consultant: 'Ahmed Al-Rashid', session_type: 'video', status: 'scheduled', scheduled_at: '2026-04-05T14:00:00Z', duration_minutes: 60 },
  { id: 'cs2', ticket_title: 'SuccessFactors Employee Central sync', consultant: 'Dr. Fatima Hassan', session_type: 'chat', status: 'scheduled', scheduled_at: '2026-04-06T10:00:00Z', duration_minutes: 30 },
];

export const mockClientPayments = [
  { id: 'p1', invoice: 'INV-2026-0042', consultant: 'Ahmed Al-Rashid', amount: 450, currency: 'USD', vat: 67.5, status: 'completed', date: '2026-03-30' },
  { id: 'p2', invoice: 'INV-2026-0041', consultant: 'Sarah Johnson', amount: 350, currency: 'USD', vat: 52.5, status: 'completed', date: '2026-03-25' },
  { id: 'p3', invoice: 'INV-2026-0043', consultant: 'Ahmed Al-Rashid', amount: 600, currency: 'USD', vat: 90, status: 'pending', date: '2026-04-03' },
];

export const mockRecommendedConsultants = [
  { id: 'c1', name: 'Ahmed Al-Rashid', specialty: 'SAP S/4HANA Finance', rating: 4.9, reviews: 127, rate: 150, avatar: 'AR', available: true, matchScore: 98, badges: ['verified', 'top_rated'], lat: 24.7136, lng: 46.6753, city: 'Riyadh', industries: ['oil', 'banking'], linkedinVerified: true, credlyVerified: true },
  { id: 'c2', name: 'Sarah Johnson', specialty: 'SAP BTP & Integration', rating: 4.8, reviews: 98, rate: 175, avatar: 'SJ', available: true, matchScore: 92, badges: ['verified', 'fast_responder'], lat: 25.2048, lng: 55.2708, city: 'Dubai', industries: ['telecom', 'retail'], linkedinVerified: true, credlyVerified: true },
  { id: 'c3', name: 'Dr. Fatima Hassan', specialty: 'SAP SuccessFactors', rating: 5.0, reviews: 87, rate: 200, avatar: 'FH', available: true, matchScore: 89, badges: ['verified', 'top_rated'], lat: 21.4858, lng: 39.1925, city: 'Jeddah', industries: ['healthcare', 'government'], linkedinVerified: false, credlyVerified: false },
  { id: 'c4', name: 'Omar Al-Zahrani', specialty: 'SAP MM/SD Functional', rating: 4.7, reviews: 64, rate: 120, avatar: 'OZ', available: false, matchScore: 85, badges: ['verified'], lat: 26.4207, lng: 50.0888, city: 'Dammam', industries: ['manufacturing', 'logistics'], linkedinVerified: true, credlyVerified: true },
  { id: 'c5', name: 'Layla Al-Harbi', specialty: 'SAP Basis & Security', rating: 4.6, reviews: 45, rate: 140, avatar: 'LH', available: true, matchScore: 80, badges: ['verified'], lat: 24.4539, lng: 39.6142, city: 'Medina', industries: ['government', 'oil'], linkedinVerified: false, credlyVerified: false },
  { id: 'c6', name: 'Tariq Mansour', specialty: 'ABAP Development', rating: 4.8, reviews: 72, rate: 160, avatar: 'TM', available: true, matchScore: 76, badges: ['verified', 'fast_responder'], lat: 25.3548, lng: 51.1839, city: 'Doha', industries: ['banking', 'telecom'], linkedinVerified: true, credlyVerified: true },
];

export const mockActivityFeed = [
  { id: 'a1', type: 'ticket_update', message: 'Ticket #T1 status changed to In Progress', time: '10 minutes ago', icon: 'ticket' },
  { id: 'a2', type: 'session_scheduled', message: 'Video session with Ahmed Al-Rashid scheduled for Apr 5, 2:00 PM', time: '1 hour ago', icon: 'calendar' },
  { id: 'a3', type: 'consultant_matched', message: 'Dr. Fatima Hassan matched to your SuccessFactors ticket', time: '3 hours ago', icon: 'match' },
  { id: 'a4', type: 'payment', message: 'Payment of $450 processed for INV-2026-0042', time: '2 days ago', icon: 'payment' },
  { id: 'a5', type: 'ticket_resolved', message: 'Ticket #T9 (FI posting period) marked as resolved', time: '5 days ago', icon: 'resolved' },
];

export const sapModules = [
  'SAP S/4HANA', 'SAP FI/CO', 'SAP MM', 'SAP SD', 'SAP PP', 'SAP QM',
  'SAP PM/EAM', 'SAP PS', 'SAP EWM', 'SAP TM', 'SAP Ariba',
  'SuccessFactors', 'SAP BTP/CPI', 'SAP Fiori/UX', 'SAP Analytics Cloud',
  'SAP Basis', 'SAP Security/GRC', 'ABAP Development', 'Integrations/APIs',
  'Data Migration', 'AMS Support', 'Health Check/Advisory',
];

export const issueTypes = [
  'Bug / Error', 'Configuration Issue', 'Performance Problem', 'Enhancement Request',
  'Integration Issue', 'Authorization / Role Issue', 'Report / Query Issue',
  'Data Migration Issue', 'Upgrade / Patch Issue', 'General Consultation',
];
