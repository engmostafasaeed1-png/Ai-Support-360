## Plan: Client Onboarding Wizard + AI Ticketing System

### Part 1: Client Onboarding Wizard (at `/client/onboarding`)
4-step wizard similar to consultant onboarding:
1. **Company Info** — Company name, size, industry, SAP landscape description
2. **Contact & Preferences** — Phone, preferred language, communication preferences, timezone
3. **SAP Modules** — Select which SAP modules the company currently uses (multi-select)
4. **Review & Submit** — Summary of all info before submitting

Database: We'll need a `client_profiles` table for company-specific info.

### Part 2: AI-Powered Ticketing System
Complete rewrite of `NewRequestPage` with AI features:

1. **AI Auto-Categorization** — Edge function that analyzes ticket title/description and suggests:
   - SAP module category
   - Urgency level (low/medium/high/critical)
   
2. **AI Smart Consultant Matching** — After ticket creation, AI recommends best consultant based on:
   - Matching SAP skills
   - Availability status
   - Rating and reviews
   
3. **AI Summary & Suggestions** — Edge function that:
   - Generates concise ticket summaries
   - Suggests potential resolution steps

### Implementation Order:
1. Database migration for `client_profiles` table
2. Build client onboarding wizard (4 steps)
3. Create AI edge functions (`ai-ticket-categorize`, `ai-ticket-match`, `ai-ticket-summary`)
4. Rebuild `NewRequestPage` with AI-powered ticket creation
5. Update `TicketsPage` with AI summaries
6. Add i18n translations (EN/AR)
