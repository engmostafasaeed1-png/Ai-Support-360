# Feature X — consultant name privacy

Database part: `docs/sql/consultant-name-privacy.sql` (prepared, not applied). Checks: `docs/sql/consultant-name-privacy.test.sql` (rolled back).

## Leak found
- `profile_directory` (the view every screen uses for names) runs with the owner's rights and lets any signed-in user read the
  full name of every verified consultant. The `profiles` table itself is safe (own row or administrators only).
- Server notifications (bid received/withdrawn, match accepted, NDA signed, session confirmed/started, remote access accepted,
  environment assigned/started), the team panel, team thread, ticket timeline, emergency contact and the info-request e-mails
  put full consultant names in texts for clients.
- The AI match suggestions read names with full rights and sent them to the AI and the client (fixed in the edge function now: masked).

## Administrators
Admins and super admins always see the full real name (Users page and drawer, consultant lists and profile, admin ticket team and bids,
invoices and payouts, audit, feedback, bulk-message previews, CSV exports, admin e-mails and digests, error reports, admin search).
Admin screens show a muted hint "Visible to clients as: M. S****" taken from the neutral-viewer name.

## Migration note
Every existing consultant starts as `masked` ("M. S****") through the column default; nothing else changes until they choose
another format in Settings > Privacy. Administrators can switch hiding off with `consultant_name_masking_enabled`.

## Arabic strings (settings UI)
| English | Arabic |
|---|---|
| How clients see your name | كيف يرى العملاء اسمك |
| Before you are ready on a ticket and you and the client have both signed the NDA, clients, other consultants and visitors see only this format. After that, that client sees your full name. Administrators always see it. | قبل أن تصبح جاهزاً في تذكرة ويوقّع كلٌّ منك ومن العميل اتفاقية عدم الإفصاح، يرى العملاء والمستشارون الآخرون والزوار هذا الشكل فقط. بعد ذلك يرى ذلك العميل اسمك الكامل. يرى المسؤولون اسمك دائماً. |
| First initial and hidden family name | الحرف الأول واسم العائلة مخفي |
| First initial and family name | الحرف الأول واسم العائلة |
| Initials only | الأحرف الأولى فقط |
| Full name | الاسم الكامل |
| Visible to clients as: | يظهر للعملاء هكذا: |
| Recommended | مُوصى به |
| Saved | تم الحفظ |
| Your choice could not be saved | تعذّر حفظ اختيارك |
| Name hiding is switched off by the platform: everyone sees full names for now. | إخفاء الأسماء متوقف من المنصة: يرى الجميع الأسماء الكاملة حالياً. |
| Hide consultant full names from clients (admin) | إخفاء الأسماء الكاملة للمستشارين عن العملاء |
