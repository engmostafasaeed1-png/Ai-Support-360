// Mock data for the consultant dashboard
export const mockConsultantProfile = {
  id: 'c1',
  user_id: 'u1',
  display_name: 'Ahmed Al-Rashid',
  avatar: 'AR',
  bio: 'Senior SAP S/4HANA Finance consultant with 12+ years of experience across GCC enterprises.',
  hourly_rate: 150,
  currency: 'USD',
  timezone: 'Asia/Riyadh',
  languages: ['en', 'ar'],
  industries: ['Oil & Gas', 'Banking', 'Manufacturing'],
  verification_status: 'verified' as const,
  rating: 4.9,
  total_reviews: 127,
  response_time_minutes: 8,
  availability_status: 'available' as const,
  ai_skills_score: 94.5,
};

export const mockEarnings = {
  total: 24750,
  thisMonth: 4200,
  pending: 1350,
  available: 3850,
  currency: 'USD',
  monthlyTrend: [
    { month: 'Jan', amount: 3200 },
    { month: 'Feb', amount: 2800 },
    { month: 'Mar', amount: 3600 },
    { month: 'Apr', amount: 4100 },
    { month: 'May', amount: 3900 },
    { month: 'Jun', amount: 4200 },
  ],
};

export const mockCases = [
  {
    id: 't1',
    title: 'S/4HANA Finance month-end close issue',
    client: 'Saudi Petrochemical Corp',
    sap_module: 'SAP S/4HANA',
    urgency: 'high' as const,
    status: 'in_progress' as const,
    created_at: '2026-04-03T10:00:00Z',
    sla_deadline: '2026-04-05T18:00:00Z',
  },
  {
    id: 't2',
    title: 'Fiori Launchpad configuration error',
    client: 'GCC Retail Group',
    sap_module: 'SAP Fiori/UX',
    urgency: 'medium' as const,
    status: 'matched' as const,
    created_at: '2026-04-04T08:30:00Z',
    sla_deadline: '2026-04-06T12:00:00Z',
  },
  {
    id: 't3',
    title: 'MM Purchase Order workflow stuck',
    client: 'Riyadh National Bank',
    sap_module: 'SAP MM',
    urgency: 'critical' as const,
    status: 'in_progress' as const,
    created_at: '2026-04-04T14:00:00Z',
    sla_deadline: '2026-04-05T10:00:00Z',
  },
  {
    id: 't4',
    title: 'FI/CO cost center report discrepancy',
    client: 'Al-Faisal Industries',
    sap_module: 'SAP FI/CO',
    urgency: 'low' as const,
    status: 'resolved' as const,
    created_at: '2026-03-28T09:00:00Z',
    sla_deadline: '2026-04-01T18:00:00Z',
    resolved_at: '2026-03-30T16:00:00Z',
  },
  {
    id: 't5',
    title: 'BTP Integration Suite connectivity',
    client: 'Jeddah Logistics Co',
    sap_module: 'SAP BTP/CPI',
    urgency: 'medium' as const,
    status: 'new' as const,
    created_at: '2026-04-05T06:00:00Z',
    sla_deadline: '2026-04-07T12:00:00Z',
  },
];

export const mockSessions = [
  {
    id: 's1',
    ticket_id: 't1',
    client: 'Saudi Petrochemical Corp',
    session_type: 'video' as const,
    status: 'scheduled' as const,
    scheduled_at: '2026-04-05T14:00:00Z',
    duration_minutes: 60,
  },
  {
    id: 's2',
    ticket_id: 't3',
    client: 'Riyadh National Bank',
    session_type: 'screen_share' as const,
    status: 'scheduled' as const,
    scheduled_at: '2026-04-05T16:30:00Z',
    duration_minutes: 45,
  },
  {
    id: 's3',
    ticket_id: 't2',
    client: 'GCC Retail Group',
    session_type: 'chat' as const,
    status: 'scheduled' as const,
    scheduled_at: '2026-04-06T10:00:00Z',
    duration_minutes: 30,
  },
  {
    id: 's4',
    ticket_id: 't4',
    client: 'Al-Faisal Industries',
    session_type: 'video' as const,
    status: 'completed' as const,
    scheduled_at: '2026-03-30T11:00:00Z',
    started_at: '2026-03-30T11:02:00Z',
    ended_at: '2026-03-30T12:15:00Z',
    duration_minutes: 73,
  },
];

export const mockReviews = [
  { id: 'r1', client: 'Saudi Petrochemical Corp', score: 5, comment: 'Outstanding S/4HANA knowledge. Resolved our month-end issue in one session.', created_at: '2026-03-30T14:00:00Z' },
  { id: 'r2', client: 'Al-Faisal Industries', score: 5, comment: 'Very responsive and professional. Great FI/CO expertise.', created_at: '2026-03-25T10:00:00Z' },
  { id: 'r3', client: 'GCC Retail Group', score: 4, comment: 'Good Fiori support, resolved our launchpad configuration quickly.', created_at: '2026-03-20T16:00:00Z' },
];

export const mockSkills = [
  { module: 'SAP S/4HANA Finance', proficiency: 5, years: 8, certified: true },
  { module: 'SAP FI/CO', proficiency: 5, years: 12, certified: true },
  { module: 'SAP MM', proficiency: 4, years: 6, certified: true },
  { module: 'SAP Fiori/UX', proficiency: 4, years: 4, certified: false },
  { module: 'SAP BTP/CPI', proficiency: 3, years: 2, certified: false },
];

export const mockCertifications = [
  { name: 'SAP Certified Application Associate - S/4HANA Finance', issuer: 'SAP', issue_date: '2023-06-15', expiry_date: '2026-06-15', verified: true },
  { name: 'SAP Certified Application Associate - Financial Accounting', issuer: 'SAP', issue_date: '2021-03-10', expiry_date: '2024-03-10', verified: true },
  { name: 'SAP Certified Technology Associate - SAP Fiori', issuer: 'SAP', issue_date: '2024-01-20', expiry_date: '2027-01-20', verified: false },
];
