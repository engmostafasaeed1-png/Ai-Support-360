# Inventory: consultant contact links / place fields (read-only, no changes)

Roles: C=client, K=consultant (own row), A=admin, S=service role (edge function), T=test/type only.

## (1) Column uses on `consultants`

### Client-facing reads
- src/hooks/useRealtimeConsultants.ts:35 — read, C (also A) — `'id, user_id, hourly_rate, industries, languages, verification_status, rating, total_reviews, response_time_minutes, availability_status, city, country, latitude, longitude, linkedin_url, linkedin_checked_at, credly_username, credly_checked_at, credibility_credits, ai_interview_badge, show_availability'` (feeds ConsultantsPage, ClientDashboard, NewRequestPage, map)
- src/hooks/useRealtimeConsultants.ts:91,93 — guest placeholder (linkedin_url null, credly from mock)
- src/pages/client/ConsultantProfilePage.tsx:90 — read, C — `'id, user_id, bio, hourly_rate, currency, languages, industries, response_time_minutes, credly_username, availability_status, rating, total_reviews, verification_status, ai_skills_score, city, country, latitude, longitude, linkedin_url, linkedin_checked_at, credly_checked_at'`
- src/pages/client/ConsultantProfilePage.tsx:169 — read, C — `'id, verification_status'`
- src/components/client/RequestBidDialog.tsx:34 — read, C — `'id, hourly_rate, rating, total_reviews, city, country, user_id, verification_status'` (renders city at :230)
- src/pages/client/SessionDetailPage.tsx:105 — read, C — `'*, consultants!sessions_consultant_id_fkey(id, user_id, hourly_rate, bio)'`
- src/pages/client/SessionsPage.tsx:40 — read, C — `'*, consultants(id, user_id, hourly_rate)'` (no target columns)
- src/pages/client/VideoSessionsPage.tsx:39 — read, C — `'*, consultants!sessions_consultant_id_fkey(id, user_id, hourly_rate)'` (no target columns)
- src/api/consultants.ts:6 — read (unused: no callers) — `'id, user_id, bio, hourly_rate, currency, timezone, languages, availability_status, rating, total_reviews, verification_status, city, country, industries, ai_skills_score, response_time_minutes'`
- src/api/consultants.ts:10,13 — read `select('*')` (unused: no callers)

### Consultant (own row) reads/writes
- src/hooks/useConsultantProfile.ts:16 — read, K — `select('*')`; :50 exposes credly_username
- src/components/profile/ProfileEditDialog.tsx:68 — read, K — `select('*')`; :119-128 update, K — bio, hourly_rate, city, country, latitude, longitude, linkedin_url, github_url, personal_website
- src/components/consultant/ConsultantLinksCard.tsx:29 — read, K — `'city, country, linkedin_url, github_url, personal_website, credly_username, linkedin_checked_at, credly_checked_at'`; :73-78 update, K — city/country/latitude/longitude/linkedin_url/github_url/personal_website/credly_username
- src/components/consultant/onboarding/ConsultantOnboarding.tsx:158 — read consultant_private `'nationality'`; :170-172 reads city, country, linkedin_url, github_url, personal_website, credly_username from own row; :255-262 update, K — linkedin_url, credly_username, github_url, personal_website, latitude, longitude (+city/country); :273 upsert consultant_private nationality
- src/components/consultant/ExperienceCvCard.tsx:74 — read consultant_private `'cv_url'`; :102 upsert consultant_private cv_url
- src/components/consultant/CredlyBadgesSection.tsx:96,121 — update, K — credly_username set/clear
- src/pages/consultant/VerificationPage.tsx:116 — read, K — `'id, credly_username, linkedin_url, linkedin_checked_at, credly_checked_at'`
- src/components/onboarding/OnboardingProgressCard.tsx:90 — read, K — `'id, bio, hourly_rate'`
- src/components/consultant/onboarding/steps/ImportStep.tsx:30-36 — form fill from parsed CV (nationality, linkedin_url, github_url, personal_website), no DB
- src/components/consultant/onboarding/steps/ProfileStep.tsx:95 — nationality form field, no DB

### Admin reads/writes
- src/pages/admin/ConsultantApprovalsPage.tsx:54-58 — read, A — `id, user_id, bio, hourly_rate, currency, languages, industries, ai_skills_score, created_at, verification_status, city, country, linkedin_url, linkedin_checked_at, credly_username, credly_checked_at, github_url, personal_website, consultant_skills (sap_module, proficiency_level), certifications (id, name, issuer, issue_date, expiry_date, document_url, verified)`
- src/components/admin/ConsultantTrustPanel.tsx:75-80 — renders, A — linkedin, credly, github, website, city/country; :85-88 update linkedin_checked_at / credly_checked_at

### Edge functions
- supabase/functions/ai-ticket/index.ts:260-264 — read, S (called by C/A for matching) — `id, user_id, bio, hourly_rate, currency, timezone, languages, industries, availability_status, rating, total_reviews, response_time_minutes, verification_status, ai_skills_score, country, credly_checked_at, linkedin_checked_at, sap_role, sap_roles, seniority_level, total_sap_years, sap_technologies, localization_countries, project_types` (bio scrubbed :373, country :377; no URLs)
- supabase/functions/ai-interview-chat/index.ts:415 — read, S — `"bio"`
- supabase/functions/ai-interview-analysis/index.ts:84 — read, S — `"bio, rating, total_reviews, languages, industries"`
- supabase/functions/parse-cv/index.ts:100-108 — AI output schema only (bio, nationality, city, country, linkedin_url, github_url, personal_website); no consultants write
- supabase/functions/parse-linkedin/index.ts:188 — read `"id"`, writes consultant_cv_profiles (not consultants)

### Types / libs / tests
- src/integrations/supabase/types.ts:1563-1668 — generated Row/Insert/Update for all listed columns; :8387 normalize_linkedin_url
- src/types/index.ts:36-44 — app type (cv_url, linkedin_url, github_url, personal_website, credly_username, profile_video_url, nationality)
- src/lib/consultantDirectory.ts:33-34, 59-63, 73-76, 96-97, 124-126 — maps row -> ConsultantLive (linkedin_url, credly_username, lat/lng)
- src/lib/consultantLinks.ts:2 — mirrors guard_linkedin_url / guard_credly_username
- Tests (T): consultantDirectory.test.ts, ConsultantApprovalsPage.test.tsx, ConsultantTrustPanel.test.tsx, ConsultantLinksCard.test.tsx, CredlyBadgesSection.test.tsx, ProfileStep.test.tsx
- src/data/clientMockData.ts:35-40 — guest mock (credly_username, lat/lng)
- profile_video_url: no runtime use in src/ or functions (types + migrations only)

## (2) Booking: inserts into `sessions` and dialogs
- src/components/client/BookingModal.tsx:154 — insert, C — {id, client_id, consultant_id, session_type, scheduled_at, status, duration_minutes, meeting_url, video_platform}; rendered by:
  - src/pages/client/ConsultantsPage.tsx:561 (opened from card button :548 and map popup onBook :411 -> mapDom.ts:154)
  - src/pages/client/ConsultantProfilePage.tsx:886 (buttons :411, :630)
- src/components/client/ScheduleMeetingDialog.tsx:238 — insert, C/A/K — {id, ticket_id, client_id, consultant_id, session_type, video_platform, scheduled_at, duration_minutes, meeting_url, status, notes, reminder_minutes}; also reads consultants `'id, user_id'` :122, :153; rendered by:
  - src/pages/client/TicketDetailPage.tsx:615 (opened :221, :272, TicketMeetingsList :505)
  - src/pages/consultant/CaseDetailPage.tsx:326 (opened :292)
- src/api/sessions.ts:18 — generic insert, no callers
- No separate "instant call" component found.

## (3) get_emergency_contact / EmergencyContactPanel
- src/components/client/EmergencyContactPanel.tsx:27 — rpc get_emergency_contact(_ticket_id), C; :34 reads consultants `'hourly_rate'`
- src/pages/client/TicketDetailPage.tsx:49 import, :437 render
- src/integrations/supabase/types.ts:8244 — generated type
- drizzle/migrations/0034_m38_...timeline.sql:305-344 — defined, grant authenticated
- supabase/migrations/20261001161306_9d110f33....sql:126-140 — redefined, grant authenticated

## (4) Database triggers/functions on link columns
- normalize_linkedin_url, normalize_credly_username, guard_linkedin_url, guard_credly_username, guard_consultant_geo, guard_consultant_trust_columns (resets/protects linkedin_checked_at, credly_checked_at) + triggers trg_guard_linkedin_url / trg_guard_credly_username / trg_guard_consultant_geo — drizzle/migrations/0008_client_cycle_m25_consultant_trust_place.sql
- guard_linkedin_url, guard_credly_username replaced (link change clears checked_at) — drizzle/migrations/0010_m27_link_change_clears_checked.sql
- REVOKE on guard_linkedin_url / guard_credly_username — drizzle/migrations/0011_m30_timesheet_rates_comments.sql:653-654
- guard_url_columns() on consultants ARRAY['linkedin_url','github_url','personal_website','profile_video_url'] — supabase/migrations/20260930230221_f5e78598....sql:1, :99 (earlier def drizzle/migrations/0032_m36...sql:99)
- guard_url_columns_links: no such name; nearest is trg_guard_path_or_url_columns_links on ticket_documents (supabase/migrations/20261001161838_...sql:43), not consultants
- sync_consultant_private (cv_url, nationality) — drizzle/migrations/0037_m40_consultant_private.sql (dropped in 0040)
- move_consultant_private_details + trg_move_consultant_private_ins/upd — drizzle/migrations/0040_m42b_empty_consultant_private_old_columns.sql:29-60
- Column creation: credly_username supabase/migrations/20260405162417_...sql:1; profile_video_url 20260405061635_...sql:74; github_url/personal_website 20260406165431_...sql:5-6

## (5) What each client screen renders
- ConsultantsPage (cards): name, specialty, rating, rate, place (city/country), availability, badges; LinkedIn href = linkedin_url (:491-492) and Credly href (:496-497); Credly filter/sort (:82, :101, :122). Map pins use lat/lng.
- Map popup (mapDom.ts / ConsultantMap.tsx): place text (:112), rate (:125), LinkedIn/Credly STATE label only, no URL (:133), weekly hours (:140-145), View/Book buttons. Pin at lat/lng.
- ConsultantProfilePage: bio (:437), place (:348, :393), ConsultantLocationMap circle at lat/lng (:442), LinkedIn href (:364-365), Credly href (:369-370), link states.
- ClientDashboard "Recommended consultants" (:95-100, :475-510): name, specialty, rating, reviews, badges, credly_username indicator (:499); no LinkedIn, no place.
- NewRequestPage consultant picker: specialty + city (:1262), search on city (:1227, :1279).
- TicketDetailPage lists:
  - TicketBids via useProposals.ts:92 — `'id, user_id, hourly_rate, rating, total_reviews'` (no target fields)
  - SendMatchRequestDialog:69 — `id, user_id, hourly_rate, currency, rating, total_reviews, ai_skills_score, availability_status, languages, response_time_minutes, consultant_skills(...)` (no target fields)
  - useMatchRequests.ts:115 — `id, user_id, hourly_rate, currency, rating, total_reviews, ai_skills_score, consultant_skills(...)` (no target fields)
  - TicketMatchRequests:49, TicketAssignments:74/110 — `'id, user_id'` / `'user_id'` (no target fields)
  - RequestBidDialog — city/country (rendered city :230)
  - EmergencyContactPanel — emergency contact from RPC, hourly_rate
