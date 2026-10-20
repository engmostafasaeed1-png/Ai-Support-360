import {
  LayoutTemplate,
  Activity, AlertOctagon, BadgeCheck, BarChart3, BellRing, BookMarked, BookOpenCheck, Blocks, Brain, Building,
  CalendarClock, ClipboardList, Crown, Database, DollarSign, FileSignature, FileText, Fingerprint,
  Flag, Gauge, GitPullRequestArrow, Gift, Headset, HelpCircle, Inbox, Kanban, Layers3, LayoutDashboard,
  ListChecks, Megaphone, MessagesSquare, Monitor, MonitorSmartphone, PanelTop, PieChart, Plug, Plus, Radio, Receipt,
  Rocket, ScrollText, Search, Server, Settings, Settings2, Shield, ShieldCheck, ShoppingBag,
  SlidersHorizontal, Sparkles, Star, StarHalf, Timer, UserCheck, UserCircle, UserCog, Users, Video,
  Wallet, Wand2, Workflow, Wrench,
} from 'lucide-react';
import type { NavGroup, NavItem } from './navTypes';

/*
 * Single source of truth for the portal side menus.
 * - Item keys are stored in user_screen_preferences: never rename one.
 * - Labels come from i18n (`sidebar.<key>` unless labelKey is set); `fallback` is only a safety net.
 * - Groups with defaultOpen are expanded for new users; the rest start collapsed.
 */

// ---------------------------------------------------------------- Client

/** Shown as the highlighted button above the menu. */
export const clientPrimaryAction: NavItem = {
  key: 'new_request',
  icon: Plus,
  path: '/client/new-request',
  fallback: 'New request',
};

export const clientNavGroups: NavGroup[] = [
  {
    id: 'overview',
    labelKey: 'sidebar.overview',
    fallback: 'Overview',
    defaultOpen: true,
    items: [
      { key: 'dashboard', icon: Gauge, path: '/client', required: true },
      { key: 'timeline', icon: Activity, path: '/client/timeline' },
    ],
  },
  {
    id: 'work',
    labelKey: 'sidebar.work',
    fallback: 'Work',
    defaultOpen: true,
    items: [
      { key: 'tickets', icon: Headset, path: '/client/tickets' },
      { key: 'consultants', icon: Search, path: '/client/consultants' },
      { key: 'consultant_responsiveness', icon: Timer, path: '/client/responsiveness', fallback: 'Responsiveness' },
      { key: 'sessions', icon: CalendarClock, path: '/client/sessions' },
      { key: 'video_sessions', icon: Video, path: '/client/video-sessions' },
      { key: 'chat', icon: MessagesSquare, path: '/client/chat' },
      { key: 'contracts', icon: ScrollText, path: '/client/contracts', fallback: 'NDA agreements' },
    ],
  },
  {
    id: 'delivery',
    labelKey: 'sidebar.delivery',
    fallback: 'Delivery',
    items: [
      { key: 'projects', icon: Layers3, path: '/client/projects' },
      { key: 'milestones', icon: Flag, path: '/client/milestones' },
      { key: 'tasks', icon: ListChecks, path: '/client/tasks' },
      { key: 'pm_tickets', icon: ClipboardList, path: '/client/pm-tickets' },
      { key: 'business_processes', icon: Workflow, path: '/client/business-processes' },
      { key: 'solution_architecture', icon: Wand2, path: '/client/solution-architecture' },
    ],
  },
  {
    id: 'service',
    labelKey: 'sidebar.servicenow',
    fallback: 'Service management',
    items: [
      { key: 'change_management', icon: GitPullRequestArrow, path: '/client/changes' },
      { key: 'major_incidents', icon: AlertOctagon, path: '/client/major-incidents' },
      { key: 'playbooks', icon: BookMarked, path: '/client/playbooks' },
    ],
  },
  {
    id: 'finance',
    labelKey: 'sidebar.finance',
    fallback: 'Finance',
    items: [
      { key: 'payments', icon: Wallet, path: '/client/payments' },
      { key: 'invoices', icon: Receipt, path: '/client/invoices' },
    ],
  },
  {
    id: 'tools',
    labelKey: 'sidebar.tools',
    fallback: 'Tools',
    items: [
      { key: 'integrations', icon: Blocks, path: '/client/integrations' },
      { key: 'remote_access', icon: MonitorSmartphone, path: '/client/remote-access' },
      { key: 'knowledge', icon: BookOpenCheck, path: '/client/knowledge' },
      { key: 'satisfaction', icon: Star, path: '/client/satisfaction' },
      { key: 'referrals', icon: Gift, path: '/client/referrals' },
    ],
  },
  {
    id: 'vmware',
    labelKey: 'sidebar.vmware',
    fallback: 'VMware',
    items: [
      { key: 'vmware_settings', icon: Wrench, path: '/client/vmware-settings' },
      { key: 'vmware_pricing', icon: DollarSign, path: '/client/vmware-pricing' },
      { key: 'vmware_console', icon: Monitor, path: '/client/vmware-console' },
    ],
  },
  {
    id: 'management',
    labelKey: 'sidebar.management',
    fallback: 'Management',
    items: [
      { key: 'team_members', icon: UserCog, path: '/client/team' },
      { key: 'reports', icon: PieChart, path: '/client/reports' },
      { key: 'sla', icon: ShieldCheck, path: '/client/sla' },
      { key: 'activity_log', icon: Radio, path: '/client/activity-log' },
    ],
  },
  {
    id: 'account',
    labelKey: 'sidebar.account',
    fallback: 'Account',
    items: [
      { key: 'company_profile', icon: Building, path: '/client/company' },
      { key: 'notifications', icon: BellRing, path: '/client/notifications' },
      { key: 'settings', icon: SlidersHorizontal, path: '/client/settings' },
      { key: 'support', icon: HelpCircle, path: '/client/support' },
    ],
  },
];

// ------------------------------------------------------------ Consultant

export const consultantNavGroups: NavGroup[] = [
  {
    id: 'overview',
    labelKey: 'sidebar.overview',
    fallback: 'Overview',
    defaultOpen: true,
    items: [
      { key: 'dashboard', icon: Gauge, path: '/consultant', required: true },
      { key: 'profile', icon: UserCircle, path: '/consultant/profile', required: true, tourId: 'nav-profile' },
    ],
  },
  {
    id: 'work',
    labelKey: 'sidebar.work',
    fallback: 'Work',
    defaultOpen: true,
    items: [
      { key: 'cases', icon: Headset, path: '/consultant/cases' },
      { key: 'requests', icon: Inbox, path: '/consultant/requests' },
      { key: 'proposals', icon: Receipt, path: '/consultant/proposals', fallback: 'My bids', tourId: 'nav-my-bids' },
      { key: 'open_tickets', icon: ShoppingBag, path: '/consultant/open-tickets', fallback: 'Open requests', tourId: 'nav-open-requests' },
      { key: 'work_diary', icon: Timer, path: '/consultant/work-diary' },
      { key: 'calendar', icon: CalendarClock, path: '/consultant/calendar', tourId: 'nav-sessions' },
      { key: 'chat', icon: MessagesSquare, path: '/consultant/chat', tourId: 'nav-messages' },
      { key: 'business_processes', icon: Workflow, path: '/consultant/business-processes' },
    ],
  },
  {
    id: 'finance',
    labelKey: 'sidebar.finance',
    fallback: 'Finance',
    items: [
      { key: 'earnings', icon: Wallet, path: '/consultant/earnings', tourId: 'nav-earnings' },
      { key: 'credits', icon: Sparkles, path: '/consultant/credits' },
    ],
  },
  {
    id: 'performance',
    labelKey: 'sidebar.performance',
    fallback: 'Performance',
    items: [
      { key: 'reports', icon: PieChart, path: '/consultant/reports' },
      { key: 'reviews', icon: StarHalf, path: '/consultant/reviews' },
      { key: 'responsiveness', icon: Gauge, path: '/consultant/responsiveness', fallback: 'My responsiveness' },
      { key: 'satisfaction', icon: Star, path: '/consultant/satisfaction' },
    ],
  },
  {
    id: 'tools',
    labelKey: 'sidebar.tools',
    fallback: 'Tools',
    items: [
      { key: 'interviews', icon: Video, path: '/consultant/interviews' },
      { key: 'remote_access', icon: MonitorSmartphone, path: '/consultant/remote-access' },
      { key: 'knowledge', icon: BookOpenCheck, path: '/consultant/knowledge' },
      { key: 'referrals', icon: Gift, path: '/consultant/referrals' },
    ],
  },
  {
    id: 'account',
    labelKey: 'sidebar.account',
    fallback: 'Account',
    items: [
      { key: 'verification', icon: Fingerprint, path: '/consultant/verification' },
      { key: 'notifications', icon: BellRing, path: '/consultant/notifications' },
      { key: 'settings', icon: SlidersHorizontal, path: '/consultant/settings' },
      // Public landing page: a new tab keeps the portal session and the current place.
      { key: 'landing_page', icon: Megaphone, path: '/for-consultants', labelKey: 'nav.landing_page', fallback: 'Landing page', external: true },
    ],
  },
];

// ----------------------------------------------------------------- Admin

export const adminNavGroups: NavGroup[] = [
  {
    id: 'overview',
    labelKey: 'sidebar.overview',
    fallback: 'Overview',
    defaultOpen: true,
    items: [
      { key: 'dashboard', icon: LayoutDashboard, path: '/admin', required: true },
      { key: 'analytics', icon: BarChart3, path: '/admin/analytics' },
    ],
  },
  {
    id: 'people',
    labelKey: 'sidebar.people',
    fallback: 'People',
    defaultOpen: true,
    items: [
      { key: 'users', icon: Users, path: '/admin/users' },
      { key: 'approvals', icon: UserCheck, path: '/admin/approvals' },
      { key: 'client_approvals', icon: BadgeCheck, path: '/admin/client-approvals', fallback: 'Client approvals' },
      { key: 'client_ratings', icon: StarHalf, path: '/admin/client-reviews', fallback: 'Client ratings' },
      { key: 'responsiveness_admin', icon: Gauge, path: '/admin/responsiveness', fallback: 'Consultant responsiveness' },
      { key: 'interview_training', icon: Brain, path: '/admin/interview-training' },
      { key: 'question_library', icon: BookMarked, path: '/admin/question-library', fallback: 'Question library' },
      { key: 'interview_templates', icon: LayoutTemplate, path: '/admin/interview-templates', fallback: 'Interview templates' },
      { key: 'consultant_interviews', icon: ClipboardList, path: '/admin/consultant-interviews', fallback: 'Consultant interviews' },
      { key: 'nda_management', icon: FileSignature, path: '/admin/nda-management' },
    ],
  },
  {
    id: 'operations',
    labelKey: 'sidebar.operations',
    fallback: 'Operations',
    defaultOpen: true,
    items: [
      { key: 'ticket_board', icon: Kanban, path: '/admin/tickets' },
      { key: 'environments', icon: Server, path: '/admin/environments' },
      { key: 'environment_logs', icon: ClipboardList, path: '/admin/environment-logs' },
      { key: 'payments_admin', icon: Wallet, path: '/admin/payments', fallback: 'Payments & payouts' },
      { key: 'knowledge_review', icon: BookOpenCheck, path: '/admin/knowledge-review', fallback: 'Knowledge review' },
      { key: 'demo_requests', icon: CalendarClock, path: '/admin/demo-requests', fallback: 'Demo requests' },
      { key: 'integrations', icon: Plug, path: '/admin/integrations' },
      { key: 'vmware_settings', icon: Settings2, path: '/admin/vmware-settings' },
    ],
  },
  {
    id: 'system',
    labelKey: 'sidebar.system',
    fallback: 'System',
    defaultOpen: true,
    items: [
      { key: 'landing_editor', icon: PanelTop, path: '/admin/landing-editor' },
      { key: 'console', icon: Shield, path: '/admin/console' },
      { key: 'settings', icon: Settings, path: '/admin/settings' },
      // Only offered to super admins (AdminSidebar filters it out for everyone else).
      { key: 'super_admin', icon: Crown, path: '/super-admin' },
    ],
  },
];

// ----------------------------------------------------------- Super admin

export const superAdminNavGroups: NavGroup[] = [
  {
    id: 'platform',
    labelKey: 'super_admin.title',
    fallback: 'Super Admin',
    defaultOpen: true,
    items: [
      { key: 'overview', icon: LayoutDashboard, path: '/super-admin', labelKey: 'super_admin.overview', fallback: 'Overview', required: true },
      { key: 'executive', icon: PieChart, path: '/super-admin/executive', labelKey: 'sidebar.executive', fallback: 'Executive dashboard' },
      { key: 'roles', icon: ShieldCheck, path: '/super-admin/roles', labelKey: 'super_admin.roles', fallback: 'Roles & auth' },
      { key: 'users', icon: Users, path: '/super-admin/users', labelKey: 'super_admin.user_management', fallback: 'User management' },
      { key: 'reports', icon: BarChart3, path: '/super-admin/reports', labelKey: 'super_admin.reports', fallback: 'Reports' },
      { key: 'config', icon: Settings2, path: '/super-admin/config', labelKey: 'super_admin.config', fallback: 'Configuration' },
      { key: 'workflows', icon: Workflow, path: '/super-admin/workflows', labelKey: 'super_admin.workflows', fallback: 'Workflows' },
      { key: 'audit', icon: FileText, path: '/super-admin/audit', labelKey: 'super_admin.audit_logs', fallback: 'Audit logs' },
      { key: 'system', icon: Activity, path: '/super-admin/system', labelKey: 'super_admin.system_health', fallback: 'System health' },
    ],
  },
  {
    id: 'portals',
    labelKey: 'sidebar.portals',
    fallback: 'Portals',
    defaultOpen: true,
    items: [
      { key: 'standard_admin', icon: Database, path: '/admin', labelKey: 'super_admin.standard_admin', fallback: 'Standard admin', required: true },
    ],
  },
];
