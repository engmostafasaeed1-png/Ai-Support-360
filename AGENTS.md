# Architecture rules

- Send payout approval emails from the dedicated authenticated payout notification function after the existing status RPC succeeds, deriving recipient, money and date server-side and deduplicating by payout ID; email failures must not undo financial actions.

- Keep invoice details in a three-zone dialog with shared billing controls and the existing admin confirmation hook; this keeps visible actions consistent with backend permissions.

- Keep timesheet PDF and CSV row models in the shared timesheet document helpers, using existing screen amounts and approval metadata; this prevents export totals and statuses from diverging.

- Keep consultant credibility calculations and star fills in the shared consultant credibility library, reused by profile and directory displays, so scores and ratings stay consistent.

- Use shared CDN logo pointers for brand artwork and local derived browser icons so all logo placements stay consistent.

- Use the consultant Profile page as the single consolidated editor, reusing existing field controls without a duplicate setup tab; legacy onboarding links must land there.
- Compute match totals server-side from bounded criterion scores and fixed weights; rank all eligible consultants before selecting the best, and expose the breakdown without private CV content.- Ticket payment terms and consultant invoices are written only via SECURITY DEFINER RPCs; a client-approved invoice becomes a pending payments row so existing billing handles collection.
- All AI calls go through the Lovable AI Gateway on its current default chat model with reasoning enabled; function tools are sent through the Responses endpoint via the shared `supabase/functions/_shared/aiResponses.ts` helper (stateless: every call resends its input with `store:false`), because the gateway's chat-completions endpoint serves text generation only.
- The live interview chat (ai-interview-chat, conversation turns only) asks the gateway for the lowest reasoning effort it accepts (none, then minimal, then low) because a person waits for every reply, and its first message is a fixed greeting sent without calling the model; evaluation, co-pilot and all other AI calls keep reasoning_effort low.

- Keep client bid comparison/deadline rules in the shared client bidding library and client mutations in useClientBids so ticket tabs and lists agree.
- Share embedded profile guide visibility and the existing completeness result through one provider; reuse wizard guide content so the active editor and interview anchor stay consistent without duplicate scoring or guide copy.
- Consultant profile field visibility/required state comes only from the admin-managed field rules via useProfileFieldRules (FieldGate/RequiredMark); client consultant lists drop ids from hidden_consultant_ids and show everyone if that call fails, so admin rules apply everywhere without blocking saves.
