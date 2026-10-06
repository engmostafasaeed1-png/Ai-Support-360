# Architecture rules

- Use shared CDN logo pointers for brand artwork and local derived browser icons so all logo placements stay consistent.

- Use the consultant Profile page as the single consolidated editor, reusing existing field controls without a duplicate setup tab; legacy onboarding links must land there.
- Compute match totals server-side from bounded criterion scores and fixed weights; rank all eligible consultants before selecting the best, and expose the breakdown without private CV content.- Ticket payment terms and consultant invoices are written only via SECURITY DEFINER RPCs; a client-approved invoice becomes a pending payments row so existing billing handles collection.
