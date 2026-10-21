# Architecture rules

Subdirectories have their own `AGENTS.md` (e.g. `supabase/functions/`, `docs/sql/`); read it before changing files there.

- Reuse the consultant payout reminder on dashboard and Earnings and render administrator readiness badges from existing presence/status metadata only; this keeps bank identifiers out of readiness UI.
- Shared Button removes its variant gradient when callers supply a base background colour, while retaining custom gradients; this preserves existing emergency and status colours without changing the Button API.
- Consultant landing and pricing pages own route head tags through useHeadTags, replacing duplicates and restoring defaults on unmount; do not also emit those tags through RouteSeo Helmet, to avoid competing deferred updates.
- Administrator full consultant profiles load only through the audited admin-only RPC in the shared sheet, with ephemeral query retention, short-lived document links and timed in-memory bank reveals; this avoids bypassing column permissions or persisting private payout data.
- Invoice details use shared billing controls and the admin confirmation hook, matching backend permissions.
- Keep timesheet PDF and CSV row models in the shared timesheet document helpers, using existing screen amounts and approval metadata; this prevents export totals and statuses from diverging.
- Consultant credibility scores and star fills come only from the shared credibility library, so profile and directory agree.
- Consultant photo performance rings come only from the shared ring library through ConsultantRing/RingAvatar (map popups via its DOM twin); the outer arc is pure client rating and the inner arc only public responsiveness, so every surface shows the same honest numbers.
- Brand artwork uses shared CDN logo pointers.
- Use the consultant Profile page as the single consolidated editor, reusing existing field controls without a duplicate setup tab; legacy onboarding links must land there.
- Rank consultants only with the shared deterministic matcher (`supabase/functions/_shared/ticketMatch.ts`: hard filters, admin-tunable weights, why-chips) everywhere, incl. directory sort; client blocks are exclusions, favourites an optional capped criterion; displays derive from its weights; AI writes text only, so rankings stay reproducible.
- Ticket payment terms and consultant invoices are written only via SECURITY DEFINER RPCs; a client-approved invoice becomes a pending payments row so existing billing handles collection.
- Keep client bid comparison/deadline rules in the shared client bidding library and client mutations in useClientBids so ticket tabs and lists agree.
- Share embedded profile guide visibility and the existing completeness result through one provider; reuse wizard guide content so the active editor and interview anchor stay consistent without duplicate scoring or guide copy.
- Consultant field visibility/required state comes only from admin field rules via useProfileFieldRules (FieldGate/RequiredMark), except hard-required country/city enforced by the shared consultant location helpers and server grace checks; client lists drop hidden_consultant_ids (show everyone if that call fails), so one rule applies everywhere without blocking saves.
- Portal-menu public links are `external: true` (new tab).
- Founding Consultant awards live in a separate read-only badge table with locked server-only allocation and audited admin RPC overrides; optional feature queries fail closed until the user applies the prepared SQL, so existing consultant queries and private profile access remain unchanged.
- Profile autosave uses loaded baselines, immutable snapshots and readiness gating; sensitive fields stay manual to prevent empty writes and audit flooding. Radix save guidance preserves focus, continuation and session rules.
- AI interviews start only through the shared interviewStart resolver (resume in-progress, else reuse newest pending, single-flight insert) behind a visible blocker/preflight; completion counts the interview as its own weighted item from the shared helper, and evaluation confirms trigger-awarded badges, so no surface creates duplicates or a different percent.
- Long ticket submits and matching runs use the shared TaskProgressPanel with real step states; new tickets save via ticketSubmission helpers (single-flight, tab-stored id) so progress stays honest and tickets never duplicate.
- Team engagement: on gated tickets only team activation writes active assignments and tickets.consultant_id, after all four gates, for client- and admin-added members (admin changes audited); team requests only invite and team rows only mirror existing tables, so access rules follow the gates.
- index.html head tags carry `data-rh="true"` so Helmet replaces them.
- Social sign-in starts only via startSocialSignIn (rechecks settings per purpose).
- Realtime uses `subscribeWhileVisible` with row filters (whole tables only on admin pages); portals and Arabic load lazily, cutting DB/bundle load.
- Window scroll rules live only in ScrollToTop/lib/scrollUtils; landing reveals use lib/reveal, which hides only what it marks, so content shows without scripts.
- Sign-up confirmation links open /auth/confirm, verifying only on a button press (code fallback) so scanners cannot use them up; expired links show ConfirmLinkProblem, never the social error.
