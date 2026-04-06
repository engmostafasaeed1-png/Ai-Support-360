
## Multi-Company Support for Clients

### Current State
- Each client belongs to one tenant (company) via `tenant_members`
- Tickets are tied to `client_id` (user) not tenant

### Changes Needed

#### 1. Database Changes
- Add `tenant_id` column to `tickets` table (if not already there) to scope tickets per company
- Update `tenant_members` to allow multiple memberships per user (already supports this — unique on `user_id + tenant_id`)
- Ensure RLS policies allow users to access data for all their tenants

#### 2. Company Management Page
- New page `/client/companies` — list all companies the user belongs to
- Ability to create a new company (tenant) from this page
- Each company card shows name, logo, ticket count

#### 3. Company Selector Flow
- After login, if user has multiple companies → show company selector
- If user has only one company → go directly to client console
- Active company stored in context (TenantContext) with ability to switch

#### 4. Ticket Scoping
- All ticket queries filtered by active `tenant_id`
- New tickets automatically tagged with current `tenant_id`

#### 5. UI Updates
- Add company switcher in sidebar header
- Company creation modal/form
- Update ClientDashboard to show company-specific data
