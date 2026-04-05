
## Support Portal Integrations

### Overview
Build a unified integration layer allowing Qurtuba tickets to sync bidirectionally with Zendesk, Freshdesk, Jira Service Management, and ServiceNow.

### Phase 1: Database & Core Infrastructure
- **`integrations` table** — stores per-client integration configs (platform, API key, webhook URL, sync settings)
- **`integration_sync_log` table** — tracks sync events, errors, and mapping between external ticket IDs and Qurtuba ticket IDs
- RLS policies so clients manage their own integrations, admins oversee all

### Phase 2: Edge Functions (one per platform)
Each function handles:
- **Inbound webhook** — receives events from the external platform (ticket created/updated/resolved) and creates/updates Qurtuba tickets
- **Outbound sync** — when Qurtuba ticket status/comments change, pushes updates to the external platform
- **Field mapping** — maps priority, status, and custom fields between systems

| Platform | API | Key Features |
|---|---|---|
| **Zendesk** | REST API v2 | Ticket CRUD, comments, status sync, webhooks |
| **Freshdesk** | REST API v2 | Ticket CRUD, notes, status mapping, webhooks |
| **Jira SM** | REST API v3 | Issue CRUD, transitions, comments, webhooks |
| **ServiceNow** | Table API | Incident CRUD, state mapping, business rules |

### Phase 3: Settings UI
- **Client Settings → Integrations** page with cards for each platform
- Connect/disconnect flow with API key input
- Sync status dashboard showing last sync, errors, mapped tickets
- Toggle for auto-sync vs manual sync

### Phase 4: Sync Engine
- Conflict resolution (last-write-wins with audit trail)
- Retry logic for failed syncs
- Rate limiting per platform API constraints

### API Keys Required
Each client provides their own platform API keys — stored as encrypted secrets per integration record.

### Implementation Order
1. Database migration (integrations + sync_log tables)
2. Integrations settings UI page
3. Edge functions for each platform (start with Zendesk)
4. Webhook endpoints for inbound sync
5. Outbound sync triggers
