
## Admin Console Redesign

Rebuild the admin area from separate pages into a **single-page Admin Console** with sidebar navigation and section switching, matching the AI Industrial Hub pattern.

### Sidebar Sections (grouped):

**Platform**
- Overview & Analytics (KPI cards, charts, role distribution)
- User Management (profiles table with role changes)
- Roles & Permissions (toggle matrix)
- Subscriptions & Plans

**Operations**
- Ticket Management (Kanban + list view)
- Consultant Approvals
- NDA Management
- Match Requests

**Security**
- Security Settings
- Authentication Config
- Data Access Policies (RLS overview)
- Audit Logs

**System**
- Notifications
- Localization (i18n)
- Appearance & Theme
- File Storage
- Email Templates
- Integrations
- Landing Page Editor
- Environments (Remote Access)
- Maintenance Mode

### Implementation:
1. Create new `AdminConsolePage.tsx` with sidebar + content switching
2. Create `AdminConsoleSidebar.tsx` with grouped sections
3. Create individual section components for each area
4. Wire up real data from existing hooks
5. Update routing to use the new console page
