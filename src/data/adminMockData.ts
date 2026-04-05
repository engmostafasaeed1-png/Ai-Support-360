export const adminStats = {
  totalUsers: 2847,
  activeConsultants: 186,
  openTickets: 342,
  revenue: 284500,
  avgResolutionTime: '4.2 hrs',
  satisfaction: 4.7,
  ticketsThisMonth: 892,
  pendingApprovals: 12,
};

export const revenueData = [
  { month: 'Jan', revenue: 42000, expenses: 18000 },
  { month: 'Feb', revenue: 48000, expenses: 19500 },
  { month: 'Mar', revenue: 52000, expenses: 21000 },
  { month: 'Apr', revenue: 46000, expenses: 20000 },
  { month: 'May', revenue: 58000, expenses: 22000 },
  { month: 'Jun', revenue: 63000, expenses: 24000 },
];

export const ticketsByStatus = [
  { name: 'New', value: 64, color: 'hsl(217, 91%, 60%)' },
  { name: 'Under Review', value: 48, color: 'hsl(45, 93%, 47%)' },
  { name: 'Matched', value: 85, color: 'hsl(262, 83%, 58%)' },
  { name: 'In Progress', value: 92, color: 'hsl(142, 76%, 36%)' },
  { name: 'Resolved', value: 53, color: 'hsl(215, 16%, 47%)' },
];

export const ticketsByModule = [
  { module: 'S/4HANA', count: 128 },
  { module: 'FI/CO', count: 96 },
  { module: 'MM', count: 74 },
  { module: 'SD', count: 68 },
  { module: 'Basis', count: 52 },
  { module: 'BTP', count: 45 },
];

export const adminUsers = [
  { id: '1', name: 'Ahmed Al-Rashidi', email: 'ahmed@example.com', role: 'client' as const, status: 'active' as const, joined: '2025-11-15', tickets: 12 },
  { id: '2', name: 'Sarah Johnson', email: 'sarah@example.com', role: 'consultant' as const, status: 'active' as const, joined: '2025-09-22', tickets: 0 },
  { id: '3', name: 'Mohammed bin Saleh', email: 'mohammed@example.com', role: 'client' as const, status: 'suspended' as const, joined: '2025-08-10', tickets: 5 },
  { id: '4', name: 'Lisa Chen', email: 'lisa@example.com', role: 'consultant' as const, status: 'active' as const, joined: '2025-10-05', tickets: 0 },
  { id: '5', name: 'Khalid Al-Mansour', email: 'khalid@example.com', role: 'admin' as const, status: 'active' as const, joined: '2025-06-01', tickets: 0 },
  { id: '6', name: 'Fatima Al-Zahrani', email: 'fatima@example.com', role: 'client' as const, status: 'active' as const, joined: '2026-01-12', tickets: 8 },
  { id: '7', name: 'David Park', email: 'david@example.com', role: 'consultant' as const, status: 'pending' as const, joined: '2026-03-01', tickets: 0 },
  { id: '8', name: 'Noura Al-Otaibi', email: 'noura@example.com', role: 'client' as const, status: 'active' as const, joined: '2026-02-18', tickets: 3 },
];

export const kanbanTickets = {
  new: [
    { id: 'T-1042', title: 'S/4HANA migration error', client: 'Ahmed Al-Rashidi', module: 'S/4HANA', urgency: 'high' as const, created: '2h ago' },
    { id: 'T-1041', title: 'FI posting date mismatch', client: 'Fatima Al-Zahrani', module: 'FI/CO', urgency: 'medium' as const, created: '4h ago' },
    { id: 'T-1040', title: 'MM purchase order approval flow', client: 'Noura Al-Otaibi', module: 'MM', urgency: 'low' as const, created: '6h ago' },
  ],
  under_review: [
    { id: 'T-1038', title: 'Fiori launchpad configuration', client: 'Ahmed Al-Rashidi', module: 'Fiori', urgency: 'medium' as const, created: '1d ago' },
    { id: 'T-1035', title: 'BTP integration failure', client: 'Fatima Al-Zahrani', module: 'BTP', urgency: 'critical' as const, created: '1d ago' },
  ],
  matched: [
    { id: 'T-1032', title: 'SD pricing condition issue', client: 'Noura Al-Otaibi', module: 'SD', urgency: 'high' as const, created: '2d ago' },
    { id: 'T-1030', title: 'Basis performance tuning', client: 'Ahmed Al-Rashidi', module: 'Basis', urgency: 'medium' as const, created: '3d ago' },
  ],
  in_progress: [
    { id: 'T-1025', title: 'SuccessFactors onboarding config', client: 'Fatima Al-Zahrani', module: 'SF', urgency: 'medium' as const, created: '4d ago' },
    { id: 'T-1022', title: 'ABAP custom report development', client: 'Noura Al-Otaibi', module: 'ABAP', urgency: 'low' as const, created: '5d ago' },
    { id: 'T-1020', title: 'Security role remediation', client: 'Ahmed Al-Rashidi', module: 'GRC', urgency: 'critical' as const, created: '5d ago' },
  ],
  resolved: [
    { id: 'T-1015', title: 'MM inventory reconciliation', client: 'Noura Al-Otaibi', module: 'MM', urgency: 'medium' as const, created: '7d ago' },
    { id: 'T-1012', title: 'FI year-end closing procedure', client: 'Fatima Al-Zahrani', module: 'FI/CO', urgency: 'high' as const, created: '8d ago' },
  ],
};

export const pendingConsultants = [
  {
    id: '1',
    name: 'David Park',
    email: 'david@example.com',
    modules: ['S/4HANA', 'BTP', 'Fiori'],
    experience: 12,
    certifications: ['SAP Certified Application Associate - SAP S/4HANA', 'SAP BTP Developer'],
    languages: ['English', 'Korean'],
    hourlyRate: 150,
    bio: 'Senior SAP architect with 12+ years across S/4HANA migrations and BTP development. Led 20+ enterprise implementations across APAC.',
    appliedAt: '2026-03-28',
    aiScore: 88,
  },
  {
    id: '2',
    name: 'Amira Hassan',
    email: 'amira@example.com',
    modules: ['FI/CO', 'MM', 'SD'],
    experience: 8,
    certifications: ['SAP Certified Application Associate - SAP S/4HANA Finance'],
    languages: ['Arabic', 'English'],
    hourlyRate: 120,
    bio: 'Functional consultant specializing in FI/CO and logistics modules. Extensive experience in Saudi Arabian enterprises.',
    appliedAt: '2026-03-30',
    aiScore: 82,
  },
  {
    id: '3',
    name: 'Michael Torres',
    email: 'michael@example.com',
    modules: ['Basis', 'Security', 'ABAP'],
    experience: 15,
    certifications: ['SAP Certified Technology Associate - System Administration', 'SAP GRC Access Control'],
    languages: ['English', 'Spanish'],
    hourlyRate: 175,
    bio: 'Technical SAP consultant with deep expertise in Basis administration, security, and custom ABAP development.',
    appliedAt: '2026-04-01',
    aiScore: 91,
  },
  {
    id: '4',
    name: 'Priya Sharma',
    email: 'priya@example.com',
    modules: ['SuccessFactors', 'Ariba'],
    experience: 6,
    certifications: ['SAP Certified Application Associate - SAP SuccessFactors Employee Central'],
    languages: ['English', 'Hindi'],
    hourlyRate: 110,
    bio: 'HR technology specialist focused on SuccessFactors implementation and optimization for mid-to-large enterprises.',
    appliedAt: '2026-04-02',
    aiScore: 76,
  },
];
