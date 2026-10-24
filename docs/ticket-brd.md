# Business Requirements Document (BRD) from a ticket

Status: **applied 2026-10-24 (migrations 0100-0102) and switched on** (`docs/sql/ticket-brd.sql`; `docs/sql/ticket-brd.test.sql` passed 22/22 on a copy of the live structure).
Until it is applied the "Create BRD" button stays hidden and `/…/tickets/:id/brd` says the feature is not switched on.
After applying, the admin switch **Admin › Settings › Business Requirements Documents** starts OFF.

Sample layout for the owner: `docs/brd-sample.pdf` (English) and `docs/brd-sample-ar.pdf` (Arabic). Invented example
(MIRO invoice blocks after an S/4HANA 2023 upgrade); regenerate with `bun scripts/brd-sample/build.ts`.

## Inventory (what existed and what was reused)

| Area | Found | Used for the BRD |
| --- | --- | --- |
| Ticket page | `TicketDetailPage` (client/admin/consultant routes), consultant `CaseDetailPage` | "Create BRD" / "Open BRD (vN)" button in the header actions; new routes `…/tickets/:id/brd`, `/consultant/cases/:id/brd` |
| Ticket documents | private bucket `ticket-documents`, `ticket_documents` rows, 60-second signed links | BRD PDFs are normal document rows (`doc_type = 'brd'`) under `<ticket>/brd/`; older ones marked superseded |
| Document access | metadata readable by client, admin, company, ticket consultant, started team members; storage narrower; NDA not checked | **Stricter dedicated rule** `brd_role_for` (the same readers + NDA signed by both for consultants), applied to BRD rows and files by restrictive policies |
| NDA | `nda_agreements` (consultant + client signatures, revoked) | both signatures, not revoked (setting `require_nda`, default on) |
| M60 contact filter | `contact_details_in_text`, `mask_contact_details`, `_shared/assignmentInfo.ts` | comments refuse contact details; all saved text is masked; the editor shows the same rule |
| AI | `_shared/aiResponses.ts` (Responses API, `store:false`), `_shared/untrustedText.ts` | new `ticket-brd` function; ticket text wrapped as untrusted data; schema-validated tool reply |
| PDF | jsPDF (invoices, timesheets, NDA); Arabic used print fallbacks | jsPDF with embedded IBM Plex Sans Arabic (see below) |
| Notifications | `safe_insert_notification`, pause-aware `sendTemplateEmail` | in-app notice from the attach function; e-mail `brd-attached` (activity category, pausable) |
| Settings | `platform_settings(key, value)` | key `ticket_brd` through `admin_brd_set_settings` (audited) |

## PDF: approach and why

Client-side **jsPDF with the embedded IBM Plex Sans Arabic font** (regular + bold, OFL licence in `public/fonts/brd/`).
jsPDF was already in the app; generating in the browser means the exact file the client reviewed is the one uploaded and
attached, with no server rendering cost. jsPDF does not order mixed Arabic/English text correctly, so `src/lib/brd/bidi.ts`
lays out each line word by word (Latin runs stay left-to-right inside Arabic lines, punctuation mirrored). Features:
cover with document control, table of contents with page numbers, running header (ticket ref + version), footer
"Confidential - shared under the NDA of this ticket" + "Page x of y", tables whose rows move to the next page with the
header repeated. Editable copies: Word-compatible `.doc` (HTML, right-to-left for Arabic) and Markdown. Fonts (≈480 KB)
load only when a PDF is made.

## Security model

- Browsers have **no table access** to the BRD tables; every read/write is a `SECURITY DEFINER` function that checks the
  caller with `brd_role_for`. Restrictive policies make BRD document rows and files under `<ticket>/brd/` follow the same
  rule, impossible to insert/replace/delete directly; the older, wider ticket-document policies cannot widen it.
- Writers: the ticket's client and admins; closed ticket = read-only until an admin reopens editing (audited).
  While the switch is OFF only admins can try it.
- Consultants: ticket consultant or ready/active team member on a team ticket, **and** NDA signed by both. Bidders,
  matched-but-not-assigned and invited team members: nothing. They see only **attached** versions (never the draft).
- Versions are immutable (trigger), never deleted (soft archive by admins with a reason); events and the view log are
  append-only. Everything disappears with the ticket (cascade), which is the only delete the triggers allow.
- AI: ticket and file text are untrusted data (`wrapTicketData`: instruction-like lines dropped, our tags neutralised,
  caps); the model must answer through a fixed function schema of plain-text blocks, which are escaped into HTML;
  secrets (passwords, tokens, keys, credentials in links) are removed with a visible "[removed]" and the client is told;
  contact details are masked. Nothing is saved without the client's action; section rewrites show a diff first.
- Files: only text the browser extracted from the client's own PDF/Word/TXT files, capped per file and count.
- Limits (admin settings): 12 AI calls per ticket/day, 40 per client/day, 3 deeper-analysis calls per ticket/day,
  3 files × 6,000 characters, 60 comments per person/day. Model + tokens logged per call (`ticket_brd_ai_usage`).
  Defaults: drafting `openai/gpt-6-luna` (cheaper), deeper analysis `openai/gpt-6-astra`; both editable.

Known limitation: the contact filter (M60) hides any number with 9+ digits, so 10-digit SAP document numbers
(e.g. purchase orders 45000…) are shown as "[hidden]" in saved text and comments. Writing them with a prefix and a
dash (e.g. "PO 4500-012345") keeps them readable.

## Applying (owner)

1. Review `docs/sql/ticket-brd.sql`. Apply it in one transaction.
2. Run `docs/sql/ticket-brd.test.sql` (rolls back; prints `ticket-brd: all 22 checks passed`).
3. Admin › Settings › Business Requirements Documents: try it as admin on a ticket, then switch it on for clients.

## Test plan (after applying)

- Client: ticket page → Create BRD → choose language/template → tick parts/files → Draft with AI → answer questions →
  Update the draft → edit, reorder, hide sections → Save as new version (Draft) → Save as Final → edit starts v(n+1).
- Versions: compare two, restore one (creates a new version), admin archive with reason.
- Attach v2 with "Notify the consultant" → consultant gets bell + e-mail; attach v3 → v2 listed superseded.
- Consultant with both-signed NDA: Open BRD (v3) → read, download PDF, comment, suggest a change → client accepts
  into draft → saves v4. Consultant without NDA / bidder: no button, page says no access.
- Client sees "Who opened it" with the consultant's view and download.
- Close the ticket → read-only; admin reopens editing.
- Arabic UI and an Arabic/both-language BRD: right-to-left editor, PDF and Word export.

## Arabic strings

All screen texts are under the `brd` key in `src/i18n/locales/ar.json` (287 strings, same keys as `en.json`); the PDF and
Word labels are in `src/lib/brd/pdf.ts` / `exportDoc.ts`; section titles and template names in
`supabase/functions/_shared/brdModel.ts`; the e-mail in `_shared/transactional-email-templates/brd-attached.tsx`.
