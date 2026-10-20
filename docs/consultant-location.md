# Fix K - consultant location (mandatory)

## Display audit (before the fix)

| Place | Before | Why |
|---|---|---|
| Consultant profile header (owner) | nothing | profile query did not read city/country |
| Public profile (client) | city only, or "Location not set" | read `city` label only; unset text shown to clients |
| Directory card + list | city/country or "Location not set" | unset text shown to clients |
| Map pin popup | city only | live directory mapper overwrote the place with the city |
| Bid card (ticket bids) | nothing | bid query did not load city/country |
| Bid-request dialog | "Location not set" to clients | used the unset fallback |
| Ticket team panel (assigned) | nothing | loaded name/avatar only |
| Invitation list + invite dialog | nothing | loaded name only |
| Admin approvals / trust panel / full profile | partial; no badge | city and country shown separately or omitted |

Not a cause: RLS or column grants (clients can read city/country), caching. Main cause: 17 of 26 consultants have no country and city, plus the omissions above. There is no flag artwork in the app, so no flag is shown.

## Behaviour now
- Everyone sees "City, Country", else the country. Unset: owner and admins see a "Location not set" badge; clients see nothing.
- Country and city are always required (independent of the enforcement switch): profile step, links card, edit dialog and sign-up (email and Google). Autosave skips the section and keeps the draft.
- Map point: listed city centre, else the country centre (no external geocoder exists in the app; the map uses the built-in city list). City level only.
- Completion counts "Location (country and city)" (one of 16 profile items + interview).
- Existing consultants: one-time prompt on next sign-in, banner on dashboard and profile, checklist item, daily reminder e-mail line (via `consultant_completion`).
- After the grace period (default 7 days from applying the SQL, admin-editable): hidden from directory/map/matching, no new bids, no accepting invitations. Declining is always allowed.
- Admin: Console > Who is missing location (grace days, Send reminder now, CSV export).
- No consultant data is changed or deleted.

## Owner action
Apply `docs/sql/interview-completion.sql`, then `docs/sql/consultant-location.sql`. Until then nobody is blocked and the admin page is read-only.

## New English strings (for Arabic)
- Add your country and city - needed to appear in search and on the map.
- Location (country and city)
- Add your country and city so clients find you in search and on the map.
- Location not set
- Add your location / Add my location / Save location / Location saved. / Later
- Add your location - needed to appear in search and on the map.
- Add your location - needed to appear in search and on the map. Please add it by {{date}}.
- Needed to appear in search and on the map. Only your city is shown, never an address.
- Country / City / Select country / Search country / No country found.
- Your map pin is the centre of {{city}}. Clients see the city, never an address.
- This city is not in our list, so your map pin is the centre of {{country}}.
- Your location is missing, so you are hidden from search, the map and matching, and cannot place new bids or accept invitations. Add it to continue.
- Add your country and city in your profile before placing bids or accepting invitations.
- Add your country and city to your profile before placing a new bid
- Add your country and city to your profile before accepting an invitation
- Something went wrong. Please try again.
- Always required (needed for search and the map)
- Who is missing location
- Consultants without a country and city. After the grace period they are hidden from search, the map and matching, and cannot place new bids or accept invitations until they add it.
- The location rules are not switched on yet (the prepared database update is not applied). The list below is read-only: no grace deadline, no blocking and no reminders until it is applied.
- Grace period / Days before blocking / Counted from {{date}} (or the sign-up date, if later). / Grace period saved. / Enter whole days between 0 and 90. / Could not save the grace period.
- {{n}} consultant(s) without a location / Export CSV / Send reminder now / Reminder sent to {{n}} consultant(s). / {{n}} skipped (already reminded in the last 24 hours). / Could not send the reminder. Please try again.
- Consultant / Status / Signed up / Deadline / Last reminder / Hidden and blocked / No name / Select all / Every consultant has a location.
- Choose between 1 and 50 consultants / Too many reminders. Please try again in an hour.
- Add your location (checklist)
