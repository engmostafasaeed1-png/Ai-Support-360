# Architecture rules

- Reuse the consultant payout reminder on dashboard and Earnings and render administrator readiness badges from existing presence/status metadata only; this keeps bank identifiers out of readiness UI.

- Shared Button removes its variant gradient when callers supply a base background colour, while retaining custom gradients; this preserves existing emergency and status colours without changing the Button API.

- Consultant landing and pricing pages own route head tags through useHeadTags, replacing duplicates and restoring defaults on unmount; do not also emit those tags through RouteSeo Helmet, to avoid competing deferred updates.

- Administrator full consultant profiles load only through the audited admin-only RPC in the shared sheet, with ephemeral query retention, short-lived document links and timed in-memory bank reveals; this avoids bypassing column permissions or persisting private payout data.

- Administrator notification emails use credential-free pg_net event callbacks and service-only atomic claims with bounded retries and managed idempotency; only stored notification content and the administrator's own address may be sent, without new queues or schedules.

- Send payout approval emails from the dedicated authenticated payout notification function after the existing status RPC succeeds, deriving recipient, money and date server-side and deduplicating by payout ID; email failures must not undo financial actions.

- Keep invoice details in a three-zone dialog with shared billing controls and the existing admin confirmation hook; this keeps visible actions consistent with backend permissions.

- Keep timesheet PDF and CSV row models in the shared timesheet document helpers, using existing screen amounts and approval metadata; this prevents export totals and statuses from diverging.

- Keep consultant credibility calculations and star fills in the shared consultant credibility library, reused by profile and directory displays, so scores and ratings stay consistent.

- Use shared CDN logo pointers for brand artwork and local derived browser icons so all logo placements stay consistent.

- Use the consultant Profile page as the single consolidated editor, reusing existing field controls without a duplicate setup tab; legacy onboarding links must land there.
- Rank consultants only with the shared deterministic matcher (`supabase/functions/_shared/ticketMatch.ts`: hard filters, admin-tunable weights from platform settings, why-chips) on every surface, including the directory's best-match sort; the AI model may only write explanation text, so rankings stay reproducible and explainable.
- Ticket payment terms and consultant invoices are written only via SECURITY DEFINER RPCs; a client-approved invoice becomes a pending payments row so existing billing handles collection.
- All AI calls go through the Lovable AI Gateway on its current default chat model with reasoning enabled; function tools are sent through the Responses endpoint via the shared `supabase/functions/_shared/aiResponses.ts` helper (stateless: every call resends its input with `store:false`), because the gateway's chat-completions endpoint serves text generation only.
- The live interview chat (ai-interview-chat, conversation turns only) asks the gateway for the lowest reasoning effort it accepts (none, then minimal, then low) because a person waits for every reply, and its first message is a fixed greeting sent without calling the model; evaluation, co-pilot and all other AI calls keep reasoning_effort low.

- Keep client bid comparison/deadline rules in the shared client bidding library and client mutations in useClientBids so ticket tabs and lists agree.
- Share embedded profile guide visibility and the existing completeness result through one provider; reuse wizard guide content so the active editor and interview anchor stay consistent without duplicate scoring or guide copy.
- Consultant profile field visibility/required state comes only from the admin-managed field rules via useProfileFieldRules (FieldGate/RequiredMark); client consultant lists drop ids from hidden_consultant_ids and show everyone if that call fails, so admin rules apply everywhere without blocking saves.

- Public-site links inside a portal menu are declared as `external: true` nav items, and every surface that renders nav groups (sidebar rows, command palette) opens them in a new tab and never marks them active; this keeps a portal session and the user place intact.

- Founding Consultant awards live in a separate read-only badge table with locked server-only allocation and audited admin RPC overrides; optional feature queries fail closed until the user applies the prepared SQL, so existing consultant queries and private profile access remain unchanged.

- Profile autosave uses loaded baselines, immutable snapshots and readiness gating; sensitive fields stay manual to prevent empty writes and audit flooding. Radix save guidance preserves focus, continuation and session rules.
- Profile interview actions use explicit start intent; evaluation confirms persisted trigger-awarded badges and refreshes profile/history caches to avoid client-fabricated awards.
