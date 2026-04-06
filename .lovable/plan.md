
# Build Complete Platform — Phased Plan

The platform has ~40+ pages across 4 roles. Many already have UI but use mock data. Here's the plan to make everything functional:

## Phase 1: Auth & Onboarding (Foundation)
- ✅ Auth already works (login, signup, roles, password reset)
- Fix client onboarding wizard to save to `client_profiles` table
- Fix consultant onboarding wizard to save to `consultants` table
- Ensure role-based routing works end-to-end

## Phase 2: Client Dashboard — Real Data
- Connect Client Dashboard KPIs to real ticket/session/payment counts
- Connect Tickets page (already uses `useClientTickets` hook ✅)
- Connect Sessions page to real `sessions` table
- Connect Payments page to real `payments` table
- Connect New Request form to create real tickets
- Connect Consultants browse page to real `consultants` table
- Connect Chat to real `messages` + `sessions` tables
- Connect Settings page to update `profiles` + `client_profiles`
- Connect Company Profile to `client_profiles`

## Phase 3: Consultant Dashboard — Real Data
- Connect Consultant Dashboard to real cases/earnings data
- Connect Cases page to real assigned `tickets`
- Connect Calendar to real `availability_slots` + `sessions`
- Connect Earnings page to real `payments` + `payouts`
- Connect Profile page to real `consultants` + `profiles`
- Connect Verification page to real `interview_sessions`
- Connect Chat to real messages

## Phase 4: Admin Dashboard — Real Data
- Connect Admin Dashboard KPIs to real aggregate queries
- Connect Users page to real `profiles` + `user_roles`
- Connect Ticket Kanban to all tickets with drag-drop status updates
- Connect Consultant Approvals to real verification workflow
- Connect Analytics to real data aggregations
- Connect Environments page to real `remote_environments`
- Connect NDA Management to real `nda_agreements`
- Connect Admin Settings to `platform_settings`

## Phase 5: Super Admin
- Connect Overview with system-wide stats
- Connect Roles & Auth management
- Connect User Management
- Connect Audit Logs to real `audit_logs` table
- Connect System Health monitoring
- Connect Workflows and Config pages

## Phase 6: Missing Pages & Polish
- Knowledge Base (articles CRUD)
- Invoices page
- Reviews page
- Remote Access (Guacamole integration)
- Integrations (Zendesk/Jira sync)

---

**Recommended approach**: Tackle one phase per conversation to keep changes manageable and testable. Each phase = 5-10 file changes.

**Which phase should we start with?**
