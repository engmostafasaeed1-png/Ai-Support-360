## Upwork-Inspired Features Implementation

### Phase 1: Database Schema
Create 3 new tables:
- **proposals** — Consultants bid on tickets with cover letter, rate, timeline
- **milestones** — Break projects into funded milestones with escrow status
- **work_diary_entries** — Time tracker entries with activity level and screenshots

### Phase 2: Talent Search & Filters (Client Portal)
- Enhanced `/client/consultants` page with advanced filters:
  - SAP module, hourly rate range, availability, rating, country, response time
  - Sort by: relevance, rating, rate, response time
  - Grid/list view toggle

### Phase 3: Proposal/Bidding System
- Consultants can submit proposals on open tickets (cover letter, proposed rate, estimated hours)
- Clients see proposals on ticket detail, compare and accept
- New consultant page: "My Proposals" to track submitted bids

### Phase 4: Time Tracker
- Work diary page showing logged hours per session
- Activity level indicator (keyboard/mouse activity %)
- Manual time entry support
- Weekly summary view

### Phase 5: Milestone Payments & Escrow
- Create milestones on projects with amounts
- Escrow states: funded → in_progress → submitted → approved → released
- Client can fund, review, and release milestones
- Consultant sees milestone progress on earnings page

### Files to create/modify:
- DB migration (3 tables + RLS)
- `src/pages/client/ConsultantsPage.tsx` — Enhanced talent search
- `src/components/client/ProposalsList.tsx` — View proposals on tickets
- `src/pages/consultant/ProposalsPage.tsx` — Consultant's proposals
- `src/components/consultant/SubmitProposalModal.tsx` — Bid on ticket
- `src/pages/consultant/WorkDiaryPage.tsx` — Time tracker
- `src/components/project/MilestoneManager.tsx` — Milestone CRUD
- Routes in App.tsx
