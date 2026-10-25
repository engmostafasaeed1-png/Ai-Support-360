# Solution Architecture documents

Client page `/client/solution-architecture`. Database rules: `docs/sql/solution-architecture.sql` (PREPARED, NOT APPLIED),
checks: `docs/sql/solution-architecture.test.sql` (one rolled-back transaction, SA01-SA20). Wording EN/AR:
`docs/solution-architecture-strings.md`.

## States
| Database update | Admin switch | What the client sees |
|---|---|---|
| not applied | – | Unchanged preview: examples with the "Preview with example data" note, Ticket references real, New Document dimmed with the honest note |
| applied | off (default) | All tabs real (own data, empty states), New Document dimmed: "the platform owner has not switched architecture documents on" |
| applied | on | Owners/admins/managers create and edit; members read and comment |
| AI | off (default) | No AI button. When on: Draft from my BRD / ticket, Suggest components and integrations, Review for gaps and risks |

## Reused from the BRD
RichTextField (editor + HTML allowlist), BrdDiffView (diff), BrdComments (now takes a `CommentApi`), the PDF engine
(Writer, IBM Plex Sans Arabic, bidi, tables), brdSafety (secrets/contacts), brdPrompt.wrapTicketData (untrusted data),
the streamed AI call (runBrdAi with the function name), brd_role_for (consultant reader rule), brd_person_name (name
privacy), mask_contact_details / contact_details_in_text (M60), the ticket_documents attach flow and the private
ticket-documents bucket.

## Settings (platform_settings.solution_architecture)
enabled false, ai_enabled false, require_nda true, ai_calls_per_doc_per_day 10, ai_calls_per_org_per_day 30,
ai_model openai/gpt-6-luna, max_brd_chars 12000, docs_per_user_per_day 30, comments_per_user_per_day 60,
uploads_per_user_per_day 60, landscape_saves_per_user_per_day 100, max_assets_per_doc 30, max_versions_per_doc 500,
max_systems 200. Changed only through admin_sa_set_settings (admins, known keys, audited).

## Test plan (after applying the SQL)
1. Client (owner of a company or own account): switch on in Admin settings -> New Document -> HLD, link a ticket with a
   BRD -> write, link REQ ids, add a Mermaid diagram and a PNG/SVG -> Save version v1 -> Compare/Restore -> Approve ->
   Export to PDF -> Attach to ticket (notify) -> Ticket references and Timeline show it.
2. Assigned consultant (NDA signed by both): document Private -> not visible; switch to Shared -> visible on the case
   page card and `/consultant/architecture/<id>`, read-only, saved versions only, can comment; contact details refused;
   the client sees the open in Activity.
3. Unassigned consultant / bidder: never sees it (no card, direct link says not found).
4. Other client: direct link says not found; lists, landscape and ticket systems stay empty.
5. Admin: opens any document via `/admin/architecture/<id>`, can edit, settings card shows usage.
6. Landscape: "password: x", "Kennwort", "كلمة المرور", `hana://user:pw@host`, API keys are refused.
