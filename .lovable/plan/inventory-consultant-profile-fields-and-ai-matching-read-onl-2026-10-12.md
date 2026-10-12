# Inventory: consultant profile fields and AI matching (read-only)

## (1) Where consultants enter or edit the fields
- languages: `src/components/consultant/onboarding/steps/ProfileStep.tsx:210-220`. Toggle chips. Options are inline at lines 20-31: en, ar, de, fr, es, hi, ur, zh, pt, ja, ko, tr. Saved to consultants.languages by `ConsultantOnboarding.tsx:249-256` (upsert).
- industries: no screen edits consultants.industries. The only industry input is the per-project "client industry" select in `ProjectsStep.tsx:130`, saved to consultant_projects.client_industry by `ConsultantOnboarding.tsx:406`. Options are inline at `ProjectsStep.tsx:12-18`: Oil & Gas, Banking & Finance, Telecom, Retail & Consumer Goods, Healthcare & Pharma, Government & Public Sector, Manufacturing, Logistics & Transportation, Education, Real Estate & Construction, Utilities & Energy, Mining & Metals, Automotive, Aerospace & Defense, Media & Entertainment, Insurance, Agriculture, Other.
- sap_roles and sap_role: `SapExpertiseCard.tsx:~203-204`. Chips plus free-text "Other". Options `SAP_ROLES` at lines 14-23: functional "Functional consultant"; technical "Technical / developer (ABAP, Fiori)"; techno_functional "Techno-functional"; architect "Solution / enterprise architect"; basis "Basis / security / admin"; integration "Integration (CPI, PI/PO, BTP)"; data_analytics "Data & analytics (BW, SAC, Datasphere)"; project_manager "Project / program manager". Saved at lines 152-153: sap_roles stores the labels, sap_role stores the key of the first role.
- seniority_level: `SapExpertiseCard.tsx:~209-213`. Single-choice dropdown. Options `SENIORITY` at lines 25-31: junior "Junior (0–3 yrs)", mid "Mid-level (3–6 yrs)", senior "Senior (6–10 yrs)", lead "Lead (10–15 yrs)", principal "Principal / expert (15+ yrs)". Saved at line 154.
- total_sap_years: `SapExpertiseCard.tsx:~216-217`. Number field, 0-50. Saved at line 155.
- sap_technologies: `SapExpertiseCard.tsx:~265-266`. Chips plus "Other". Options `TECHNOLOGIES` at lines 33-37: S/4HANA On-Premise, S/4HANA Cloud Public, RISE / Private Cloud, ECC 6.0, HANA DB, ABAP, ABAP OO, ABAP RAP, CDS Views, Fiori / UI5, BTP, CAP, Cloud Integration (CPI), PI/PO, IDoc / EDI, OData, BW/4HANA, SAC, Datasphere, Workflow, Adobe Forms, SmartForms, Solution Manager, Cloud ALM, GRC, Ariba, SuccessFactors, Concur, Signavio. Saved at line 156.
- localization_countries: `SapExpertiseCard.tsx:~270-272`. Chips plus "Other". Options `LOCALIZATIONS` at lines 39-43: Saudi Arabia, United Arab Emirates, Egypt, Qatar, Kuwait, Bahrain, Oman, Jordan, Morocco, Algeria, Tunisia, Turkey, Pakistan, India, Germany, United Kingdom, France, Italy, Spain, Netherlands, United States, Canada, Brazil, Mexico, South Africa, Nigeria, Kenya, Singapore, Malaysia, Indonesia, China, Japan, Australia. Saved at line 157.
- project_types: `SapExpertiseCard.tsx:~276-277`. Chips plus "Other". Options `PROJECT_TYPES` at line 45: Greenfield implementation, Brownfield conversion, Selective data transition, Rollout, Upgrade, AMS / support, Optimization. Saved at line 158.
- SAP modules (consultant_skills): `SapExpertiseCard.tsx:~222-257`. Searchable checkboxes from `ALL_SAP_AREAS` (`src/lib/sapAreas.ts`), plus free text, a 1-5 level and years. Saved at lines 174-176 (upsert into consultant_skills) and deleted at line 186. Onboarding SkillsStep `SkillsStep.tsx:82-125` uses a select per module, years, a 1-5 slider and a certified switch, saved by `ConsultantOnboarding.tsx:336`.
- Weekly availability: `AvailabilityStep.tsx:59-127` (day buttons plus day/start/end selects, 30-minute steps), saved to availability_slots by `ConsultantOnboarding.tsx:422`. Also `SetAvailabilityDialog.tsx:63-138` (recurring or specific-date slots, insert and delete on availability_slots).
- availability_status: `AvailabilityToggle.tsx:58,91` updates consultants.availability_status.
- Where the card appears: `ConsultantOnboarding.tsx:469` mounts SapExpertiseCard in the Profile page (`ProfilePage.tsx:30`).
- Not covered by these screens: `ProfileEditDialog.tsx:124` edits only bio, rate, city, country and links. ConsultantLinksCard handles links only.

## (2) Where the fields are shown
- Client directory: `src/lib/consultantDirectory.ts:32-128` maps industries and languages. `useRealtimeConsultants.ts:35` loads them. `ConsultantsPage.tsx:34,87,94,280,350` provides the industry and language filters.
- Client consultant profile: `ConsultantProfilePage.tsx:89,136-137,379` (languages) and `:584-588` (industries card). The SAP role, seniority, technology, localization and project-type fields are not shown to clients.
- Admin approvals: `ConsultantApprovalsPage.tsx:54,95,279` shows languages and loads industries.
- Shared readers: `useConsultantProfile.ts:17,52` and `src/api/consultants.ts:6-13`.

## (3) Matching logic
- `supabase/functions/ai-ticket/index.ts` has these actions: categorize (114), summarize (152), match (189, text advice only) and match_consultants (226).
- Ticket input: lines 243-248 load title, description, sap_module(s), sap_module_other, area_details, urgency, preferred_language and client_id.
- Client input: lines 250-251 load client_profiles industry, headquarters, timezone, sap_product, sap_version, sap_database_type, sap_hosting_type, sap_interfaces and sap_third_party_tools. Lines 285-286 load the tenant.
- Candidate query: lines 257-272 load verified consultants only, 500 per page.
- Supporting data: lines 290-330 load skills, certifications, profiles, interview_sessions, consultant_projects, NDAs, sessions, the `consultants_solved_similar` lookup (316), cv_profiles, work_history, education and availability_slots.
- Data sent to the model: lines ~370-440. Bio, CV summary and keywords, CV excerpt, job titles and descriptions, and project descriptions pass through `scrubText` (`_shared/scrub.ts`). Country is sent as-is (377). Employer names are never sent (419).
- Prompt: rubric at ~444-500 (lines 457-458 cover role, seniority, technologies, localization and project types; 47-48 of the rubric say language only, never nationality). Ticket block at 509-514.
- Scoring: the model returns sub-scores (534-547). `weightedMatch` (`_shared/matchScoring.ts`, weights 35/25/10/10/8/5/5/2) recomputes the total at line 589. Lines 581-614 keep only consultants that were sent, scrub the text, remove duplicates, sort by total, then skill score, then id, and return the top 5.
- Callers:
  - `NewRequestPage.tsx:273,293,309,325-327` (also the picker at 1168).
  - `SendMatchRequestDialog.tsx:136-138`.
  - Admin `SendMatchDialog.tsx:68-70`.
- Client dashboard "recommended consultants": `ClientDashboard.tsx:95,456`.
- Database: there is no consultant_matches table and no ranking database function. The only database helper is `consultants_solved_similar`.

## (4) Client-side company inputs
- `src/lib/companyOptions.ts:2-8`:
  - COMPANY_INDUSTRIES: oil_gas, petrochemical, banking, telecom, healthcare, retail, manufacturing, government, education, construction, logistics, utilities, technology, other.
  - COMPANY_SIZES: 1-10, 11-50, 51-200, 201-500, 501-1000, 1000+.
- `CompanySelectorPage.tsx:28,120,127,245,252`: industry and size selects, saved to tenants.
- `CompanyProfilePage.tsx:39,539,546` (industry and size), `:556-557` (headquarters, free text), `:575-581` (SAP landscape description and notes). Saved at 331-356 to client_profiles and tenants.
- `OtherCompanyProfile.tsx:44,96`: industry and size of tenants.
- `CompanyStep.tsx:9-13`: its own inline industry list, the same 14 keys as COMPANY_INDUSTRIES. SAP landscape is a text field at 62-67.
- `ProfileEditDialog.tsx:234-239`: industry and headquarters as free text.
- There is no country dropdown for clients. Headquarters is free text.

## (5) Tests
- For (1): `ConsultantLinksCard.test.tsx`, `LinkStatus.test.tsx`, `WeeklyAvailability.test.tsx`, `onboardingDedupe.test.ts`, `sapAreas.test.ts`, `geo.test.ts`, `consultantLinks.test.ts`, `consultantContactLinks.test.tsx`, `ConsultantApprovalsPage.test.tsx`, `consultantDirectory.test.ts`. There are no tests for SapExpertiseCard or the onboarding steps.
- For (3): `src/lib/matchScoring.test.ts`, `src/lib/scrub.test.ts`. There are no tests for ai-ticket or the matching callers.
- Client options: `companyOptions.test.ts`.
