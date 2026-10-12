# Bidding feature inventory (read-only, no changes)

## 1. Consultant side
- src/App.tsx:70,315 - route /consultant/proposals -> ProposalsPage; App.tsx:315 /consultant/open-tickets -> OpenTicketsPage; App.tsx:316 /consultant/tickets/:ticketId -> shared TicketDetailPage
- src/components/sidebar/navConfig.ts:154 - menu "Proposals" (en.json:296) -> /consultant/proposals
- src/components/sidebar/navConfig.ts:155 - menu "Open tickets" (en.json:297) -> /consultant/open-tickets
- src/pages/consultant/OpenTicketsPage.tsx:25-38 - query: status new/under_review, no consultant; visibility decided by the database (open for bids or invited)
- OpenTicketsPage.tsx:80,82 - title "Open Tickets", subtitle "Browse open tickets and submit your bids."
- OpenTicketsPage.tsx:113 - search "Search tickets..."
- OpenTicketsPage.tsx:137-138 - empty state "No open tickets match your search."
- OpenTicketsPage.tsx:147 - title links to /consultant/tickets/:id (details)
- OpenTicketsPage.tsx:180 - badge "Accepting Bids" / "Private invitation"
- OpenTicketsPage.tsx:186 - SubmitProposalModal trigger on every card
- src/pages/consultant/RequestsPage.tsx - private invitations (match requests) accept/decline, notification link target
- src/components/consultant/SubmitProposalModal.tsx:100,107 - trigger "Submit Proposal" / "Submit v{n}"
- SubmitProposalModal.tsx:127 - list of earlier versions (rate/hr, hours)
- SubmitProposalModal.tsx:141-147 - "Cover Letter" (voice input; placeholder "Explain why you're the best fit...")
- SubmitProposalModal.tsx:155,165,175 - "Rate ($/hr)", "Est. Hours", "Days"
- SubmitProposalModal.tsx:58 - cover letter required ("Please write a cover letter")
- SubmitProposalModal.tsx:59 - rate >0 and <=100,000
- SubmitProposalModal.tsx:60 - hours >=0 (<=100,000); :61 days 0-3,650; :62-63 duplicate required check
- SubmitProposalModal.tsx:187-191 - estimated total = rate x hours
- SubmitProposalModal.tsx:208-228 - "Attachments" (rules in src/lib/attachments.ts: 10 MB, allowed types)
- SubmitProposalModal.tsx:246-247 - button "Submit Proposal" / "Submit Revision v{n}" / "Submitting..."
- SubmitProposalModal.tsx:79 - after submit: toast "Proposal submitted!" / "Proposal v{n} submitted!", form reset, modal closes; :84 "Failed to submit proposal"
- src/hooks/useProposals.ts:124-179 - useSubmitProposal: insert proposals, upload to proposal-documents, insert proposal_attachments; "editing" = new version row (no in-place edit)
- src/hooks/useProposals.ts:6-51 - useConsultantProposals (the "My bids" list); :53-73 useProposalVersions
- src/pages/consultant/ProposalsPage.tsx:39,41 - "My Proposals", "Track your submitted proposals and bids on open tickets."
- ProposalsPage.tsx:45-64 - counters Total / Pending / Accepted
- ProposalsPage.tsx:67 - filters All / Pending / Accepted / Rejected (no Withdrawn filter)
- ProposalsPage.tsx:87 - empty state "No proposals found."
- ProposalsPage.tsx:10-15 - status labels Pending/Accepted/Rejected/Withdrawn; :142 client note shown
- ProposalsPage.tsx:95 - cards look clickable (cursor-pointer) but have no link or action
- src/components/consultant/CriticalAlarm.tsx:135,158,168 - critical request alarm opens SubmitProposalModal ("Reply with a proposal...")
- src/components/consultant/CriticalDashboardNotice.tsx:53 - dashboard notice opens SubmitProposalModal
- Notifications: "Proposal Accepted" / "Proposal Declined" -> /consultant/proposals (DB trigger, below); "New Ticket Match Request" -> /consultant/requests

## 2. Client side
- src/pages/client/TicketDetailPage.tsx:235 - button "Request Bids" / "Manage Bids"
- TicketDetailPage.tsx:255-257 - badge "Open for Bids"
- TicketDetailPage.tsx:302-307 - tabs: Overview, Work & plan, Sessions & chat, Time & billing, Files & links, Activity (no separate Bids tab)
- TicketDetailPage.tsx:516 - TicketBids rendered inside a tab section
- TicketDetailPage.tsx:649 - RequestBidDialog (isOpenForBids)
- src/components/client/RequestBidDialog.tsx:253-255 - "Choose how you want to invite consultants to bid" / manual / AI
- RequestBidDialog.tsx:136-144 - public bids: sets open_for_bids + opened_for_bids_at; toast "Ticket is now open for public bids!"
- RequestBidDialog.tsx:162-185 - private invitations = ticket_match_requests insert; toast "Private bid invitations sent to {n} consultant(s)!"
- RequestBidDialog.tsx:310 - "Review incoming bids in the "Bids" tab." (no tab with that name)
- RequestBidDialog.tsx:326-331 - "Edit / Invite More", close bidding; :193-199 "Bidding closed for this ticket."
- RequestBidDialog.tsx:431,440 - "Top matches for ...", "No module-matched consultants found. Try manual selection."
- src/pages/client/TicketsPage.tsx:162-163 - list badge "Bids Open"
- src/components/client/TicketBids.tsx:52 - empty state "No bids received yet."
- TicketBids.tsx:85-95 - card: consultant name, status badge, rating, rate/hours/days
- TicketBids.tsx:161,170 - "Accept Bid" / "Reject"; :190,199 second pair "Accept" / "Reject"; :207 "Add Note"
- TicketBids.tsx:36,40 - toasts "Bid accepted!" / "Bid rejected." / "Failed to respond."
- src/hooks/useProposals.ts:75-122 - useTicketProposals; :181-206 useRespondToProposal (accept = RPC accept_proposal; reject = plain update)
- src/components/client/TicketTimeline.tsx:129-134 - "Bid from {name}" timeline entries
- src/components/client/TicketMatchRequests.tsx - status of private invitations
- src/components/client/CriticalRequestPanel.tsx - critical replies list (responders)
- Notification to client: "New Proposal Received" -> /client/tickets/:id

## 3. Database
- Table proposals: id, ticket_id, consultant_id, cover_letter, proposed_rate, estimated_hours, timeline_days, status (proposal_status: pending/accepted/rejected/withdrawn), client_notes, version, parent_proposal_id, created_at, updated_at
- Table proposal_attachments (9 cols); bucket proposal-documents
- tickets.open_for_bids, tickets.opened_for_bids_at (no deadline column)
- Policies proposals: "Verified consultants can bid on tickets they can see" (INSERT, supabase/migrations/20261001155751...sql:154); "Consultants can view own proposals"; "Consultants can update own proposals"; "Clients can view proposals on their tickets"; "Clients can update proposals on their tickets"; "Company members can view the company's bids"; "Admins can manage all proposals"
- Policies proposal_attachments: consultant INSERT own, SELECT own, DELETE own (clients read via TicketBids select)
- Policies ticket_match_requests: client INSERT/SELECT/UPDATE (withdraw), company SELECT, consultant SELECT/UPDATE (respond), admin ALL
- Policies critical_replies: consultant SELECT own, admin SELECT
- Triggers proposals: trg_guard_proposal_status (client may only change status/notes; insert forced pending), trg_guard_no_contact_cover (no contact details in cover letter), trg_notify_proposal_events, trg_approve_rate_from_proposal, trg_critical_proposal_reply, update_proposals_updated_at
- Triggers tickets: trg_close_bidding_on_assignment (open_for_bids=false when consultant set), trg_tickets_critical_insert, trg_tickets_critical_alarm
- Triggers ticket_match_requests: on_match_request_created (notify_match_request), on_match_request_accepted, trg_notify_match_request_withdrawn, trg_guard_match_request_columns, trg_guard_verified_consultant, trg_critical_match_reply
- RPC accept_proposal (drizzle/migrations/0032_m36...sql:191): client/admin only, pending only, ticket not finished, consultant verified; accepts, assigns, sets in_progress, rejects other pending bids
- approve_rate_from_proposal / propose_ticket_rate - accepted bid rate becomes the ticket rate
- critical_proposal_reply -> critical_record_reply(ticket, consultant, 'proposal'): a bid counts as a critical reply (surcharge if in time)
- notify_proposal_events (supabase/migrations/20261001160857...sql:46): INSERT -> client "New Proposal Received (vN)"; status to accepted/rejected -> consultant "Proposal Accepted"/"Proposal Declined"
- Not notified: withdrawn; new public request open for bids (only invited/critical consultants get alerts); no e-mails for any bid event (only critical-request-alert sends e-mail/Telegram/push)

## 4. Missing or confusing today
- No withdraw button (status "withdrawn" exists but nothing sets it)
- Edit = new version row; old version stays pending
- No bidding deadline; open_for_bids only closes by hand or on assignment
- No counter-offer; client can only accept, reject, or add a note
- No comparison view (no sort, no side-by-side)
- No Q&A before bidding
- Rejected bidders get "Proposal Declined" from accept_proposal, but it doesn't tell them another consultant was chosen
- No notice to consultants when a public request opens for bids
- No e-mail for bid events
- Open tickets list shows no "already bid" mark or bid count; modal opens on every card
- My Proposals cards have no link to the ticket or the client's answer page; no Withdrawn filter
- Dialog says "Bids" tab; the tab does not exist (bids sit inside another tab)
- Two Accept/Reject button pairs in TicketBids
- Menu labels mix "Proposals", "Open tickets", "Requests" for related flows
- Currency fixed as "$/hr" in the form

## 5. Tests touching bidding
- src/components/consultant/CriticalAlarm.test.tsx
- src/components/consultant/CriticalDashboardNotice.test.tsx
- src/components/client/CriticalRequestPanel.test.tsx
- src/lib/criticalService.test.ts
- src/lib/attachments.test.ts (attachment rules used by the form)
- No tests for SubmitProposalModal, TicketBids, ProposalsPage, OpenTicketsPage, useProposals or RequestBidDialog
