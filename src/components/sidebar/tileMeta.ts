// Short description + next-action hint for each sidebar tile.
// Used by Client and Consultant sidebars to render rich hover tooltips.
export interface TileMeta {
  description: string;
  hint: string;
}

export const clientTileMeta: Record<string, TileMeta> = {
  dashboard: { description: 'Overview of your activity, KPIs and alerts.', hint: 'Click to see today\'s summary' },
  new_request: { description: 'Open a new SAP support ticket in seconds.', hint: 'Click to start a guided request' },
  tickets: { description: 'All your open and closed support tickets.', hint: 'Click to triage your queue' },
  consultants: { description: 'Browse and match with vetted SAP consultants.', hint: 'Click to find an expert' },
  sessions: { description: 'Scheduled working sessions with consultants.', hint: 'Click to manage upcoming meetings' },
  video_sessions: { description: 'Live video calls and recordings.', hint: 'Click to join or review a session' },
  projects: { description: 'Long-running engagements and deliverables.', hint: 'Click to review project status' },
  milestones: { description: 'Key dates and acceptance gates.', hint: 'Click to track milestone progress' },
  tasks: { description: 'Actionable items assigned across your team.', hint: 'Click to update your tasks' },
  contracts: { description: 'NDAs and engagement agreements.', hint: 'Click to sign or review documents' },
  business_processes: { description: 'Mapped SAP business processes for your org.', hint: 'Click to view process catalog' },
  chat: { description: 'Direct messages with consultants and your team.', hint: 'Click to open conversations' },
  change_management: { description: 'Track and approve SAP changes.', hint: 'Click to review change requests' },
  major_incidents: { description: 'High-severity incidents needing attention.', hint: 'Click to coordinate response' },
  playbooks: { description: 'Reusable runbooks for common issues.', hint: 'Click to launch a playbook' },
  payments: { description: 'Payment methods and transaction history.', hint: 'Click to manage billing' },
  invoices: { description: 'Invoices issued by consultants.', hint: 'Click to review and pay' },
  integrations: { description: 'Connect Jira, Slack, Teams and more.', hint: 'Click to manage integrations' },
  remote_access: { description: 'Secure remote sessions to your systems.', hint: 'Click to start or audit a session' },
  vmware_settings: { description: 'VMware environment configuration.', hint: 'Click to adjust settings' },
  vmware_pricing: { description: 'VMware usage and cost overview.', hint: 'Click to see pricing details' },
  vmware_console: { description: 'Direct console for your VMs.', hint: 'Click to open the console' },
  knowledge: { description: 'Articles and solutions library.', hint: 'Click to search the knowledge base' },
  pm_tickets: { description: 'Project management work items.', hint: 'Click to plan upcoming work' },
  solution_architecture: { description: 'AI-assisted solution design.', hint: 'Click to design a solution' },
  satisfaction: { description: 'CSAT ratings and feedback trends.', hint: 'Click to review satisfaction scores' },
  referrals: { description: 'Invite peers and earn rewards.', hint: 'Click to share your referral link' },
  team_members: { description: 'Manage users and permissions.', hint: 'Click to invite or update roles' },
  reports: { description: 'Analytics across tickets, spend and SLA.', hint: 'Click to explore reports' },
  sla: { description: 'Service-level targets and breaches.', hint: 'Click to monitor SLA health' },
  activity_log: { description: 'Audit trail of recent actions.', hint: 'Click to review activity' },
  company_profile: { description: 'Your organization details.', hint: 'Click to update company info' },
  notifications: { description: 'In-app and email alert preferences.', hint: 'Click to tune notifications' },
  settings: { description: 'Personal and workspace settings.', hint: 'Click to adjust preferences' },
  support: { description: 'Contact the AI SAP Support team.', hint: 'Click to get help' },
};

export const consultantTileMeta: Record<string, TileMeta> = {
  dashboard: { description: 'Snapshot of your work, earnings and pipeline.', hint: 'Click to see today\'s overview' },
  onboarding: { description: 'Steps to activate your consultant profile.', hint: 'Click to continue onboarding' },
  cases: { description: 'Active client engagements and cases.', hint: 'Click to manage your cases' },
  requests: { description: 'Incoming match requests from clients.', hint: 'Click to respond to requests' },
  proposals: { description: 'Proposals you\'ve submitted to clients.', hint: 'Click to track your proposals' },
  open_tickets: { description: 'Public tickets open for bidding.', hint: 'Click to find new work' },
  work_diary: { description: 'Time tracking and activity logs.', hint: 'Click to log billable hours' },
  calendar: { description: 'Your scheduled meetings and availability.', hint: 'Click to manage your calendar' },
  earnings: { description: 'Payouts, balances and history.', hint: 'Click to review your earnings' },
  chat: { description: 'Direct messages with clients.', hint: 'Click to open conversations' },
  reviews: { description: 'Client feedback and ratings.', hint: 'Click to read your reviews' },
  profile: { description: 'Your public consultant profile.', hint: 'Click to polish your profile' },
  interviews: { description: 'AI interviews and skill validations.', hint: 'Click to take or review interviews' },
  verification: { description: 'Identity and credential verification.', hint: 'Click to complete verification' },
  remote_access: { description: 'Secure remote sessions to client systems.', hint: 'Click to start a session' },
  knowledge: { description: 'Knowledge base and shared resources.', hint: 'Click to browse articles' },
  business_processes: { description: 'SAP business processes you support.', hint: 'Click to manage your specialties' },
  satisfaction: { description: 'Your CSAT scores from clients.', hint: 'Click to review feedback' },
  reports: { description: 'Analytics on your performance.', hint: 'Click to explore your stats' },
  referrals: { description: 'Invite consultants and earn rewards.', hint: 'Click to share your referral link' },
  notifications: { description: 'Alert and email preferences.', hint: 'Click to tune notifications' },
  settings: { description: 'Account and workspace settings.', hint: 'Click to adjust preferences' },
};

export function getTileMeta(
  scope: 'client' | 'consultant',
  key: string,
  fallbackLabel: string
): TileMeta {
  const map = scope === 'client' ? clientTileMeta : consultantTileMeta;
  return (
    map[key] || {
      description: `${fallbackLabel} section.`,
      hint: `Click to open ${fallbackLabel}`,
    }
  );
}
