# Consultant profile saving audit (Feature D)

## Before → after
- Personal/name/bio, nationality/location, rate/currency/timezone, social links and languages: one shared Profile details Save also wrote unrelated sections → individual Save/status controls with changed-field payloads.
- Certifications, education, project portfolio: no section Save, depended on Profile details or the bottom shared Save → individual section Save/status controls.
- SAP roles/seniority/years/technologies: own Save previously wrote all columns → dirty-only Save/status.
- SAP modules: Add/remove persisted immediately, no Save → staged additions/removals with Save/status.
- Industries, customer segments, verticals, localization countries/solutions, project types/deployment/scale, work mode/week/on-site countries, language levels: own combined experience Save previously wrote every column → dirty-only combined Save/status, covering every displayed field.
- Work history: modal Save existed → dirty-only modal Save/status, four-second autosave after activation, drafts remain open and retained on failure.
- Availability: modal Save existed → dirty-only slot Save/status, stable IDs, four-second autosave after activation.
- Payout details: explicit acknowledged Save existed → remains manual, disabled when unchanged, status/inline failures; never automatic.
- CV: selecting a file was an explicit upload-and-save action; retains existing explicit Attach/Replace CV, followed by explicit imported-data confirmation. Never autosaves a CV upload.
- Avatar and online availability toggle: explicit immediate action controls, not editable section drafts; retained.
- Interview history/transcripts: read-only; no meaningless Save added.
- Legacy onboarding URL redirects to this consolidated Profile editor; no duplicate editor introduced.

## Database inspection and activation
Live triggers on consultants and profiles audit each write. Ordinary edits do NOT produce administrator profile-update notifications/emails. Verification notifications only fire on verification_status changes. LinkedIn/Credly changes clear checked status; certificate substance changes clear certificate verification. These sections stay manual and explain the effect.

`docs/sql/profile-autosave.sql` is NOT APPLIED. It preserves scrubbed audit changes, coalesces consultant-owned profiles/consultants updates into one audit row per burst (30 seconds without changes ends a burst), preserves every other business trigger and exposes an authenticated readiness check. All ordinary draft autosaving stays OFF until this SQL is applied, so the present backend cannot receive a write every four seconds from this feature. Manual section saves work now. No edge function, secret, or database change applied.

Browser beforeunload warns when dirty; browser termination cannot guarantee delivery of asynchronous requests. Valid automatic drafts flush on section focus change, navigation, hidden tabs and unmount. Sensitive manual drafts warn but do not write on unload. Drafts live in memory, never localStorage.

## New English strings for Arabic rows
| Key | English |
| --- | --- |
| profile_save.saving | Saving... |
| profile_save.pending | Unsaved changes - saving in 4 s |
| profile_save.unsaved | Unsaved changes |
| profile_save.just_now | Saved just now |
| profile_save.all_saved | All changes saved |
| profile_save.failed | Could not save changes. Try again. |
| profile_save.required | Complete the required fields in this section before saving. |
| profile_save.rate_invalid | Enter a valid hourly rate. |
| profile_save.rows_invalid | Complete each entry and check its dates before saving. |
| profile_save.cert_manual | Certificate changes require another verification check. Save them manually. |
| profile_save.links_manual | Changing LinkedIn or Credly links clears their checked status. Save links manually. |
| profile_save.setup_pending | Automatic saving is not active yet. Use Save to keep your changes. |
| profile_save.importance | Complete your profile and AI interview |
| profile_save.welcome | Welcome. Complete your profile and take the AI interview before applying to bids. |
| profile_save.before | Before you save: complete profiles are shown to clients first and are the ones invited to bids; you are at {{percent}} %. Missing: {{missing}}. |
| profile_save.interview | Take the AI interview to earn a Gold/Silver/Bronze credibility badge - verified consultants with a badge are trusted more by clients. |
| profile_save.start | Start AI interview |
| profile_save.later | Later |
| profile_save.complete | Complete now |
| profile_save.continue | Continue saving |
| profile_save.slots_invalid | Check your time slots for overlaps and invalid times. |

Existing reused strings: Save, Dismiss, Close, Company and job title are required, End date must be after start date, Years of SAP experience must be 0–50, Your consultant profile could not be found., Could not save your availability. Completion missing-item labels reuse the existing profileCompleteness labels.

## Manual-save dialog refresh: English strings for Arabic
The 10–15 minute estimate matches the existing consultant landing page and profile guide; it is an estimate, not a guaranteed duration. Directory ranking and accepted-bid promises are intentionally omitted: current directory ordering does not guarantee either outcome.

| Key | English |
| --- | --- |
| profile_save.boost_title | Boost your profile before you save |
| profile_save.boost_description | Let clients see a clearer picture of your expertise. You can save now and finish later. |
| profile_save.completion_label | Profile completion |
| profile_save.interview_label | AI interview |
| profile_save.not_taken | Not taken |
| profile_save.badge_earned | {{badge}} badge earned |
| profile_save.interview_completed | Interview completed |
| profile_save.missing_labels | Missing: {{missing}} |
| profile_save.why_matters | Why it matters |
| profile_save.directory_benefit | A complete profile helps clients assess your expertise when browsing the directory and inviting bids. |
| profile_save.badge_benefit | An AI interview badge shows your assessed SAP knowledge and gives clients another way to evaluate your skills. |
| profile_save.trust_benefit | Your badge and complete profile help clients make an informed choice. Bid acceptance is never guaranteed. |
| profile_save.duration_benefit | Allow about 10–15 minutes for the AI interview. |
| profile_save.tier_gold | Gold |
| profile_save.tier_silver | Silver |
| profile_save.tier_bronze | Bronze |
| profile_save.tier_verified | Verified |
| profile_save.save_later | Save and continue later |
| profile_save.complete_profile | Complete my profile |
| profile_save.interview_now | Take the AI interview now |
