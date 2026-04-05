
# Smart SAP Support Portal — Qurtuba Talks

## Overview
A premium enterprise SAP support marketplace with 3 roles (Client, Consultant, Admin), AI-powered matching, ticketing, real-time communication, billing, analytics, and full Arabic/English localization.

## Design System
- **Background**: White (#FFFFFF)
- **Primary**: Dark navy blue (#1B2559)
- **Secondary**: Cool grey palette (#64748B, #94A3B8, #E2E8F0)
- **Accent**: Electric blue (#3B82F6) for CTAs and highlights
- **Cards**: Rounded-2xl, soft shadows, glassmorphism accents
- **Typography**: Inter for English, IBM Plex Sans Arabic for Arabic
- **Layout**: Sidebar dashboard with sticky top nav
- **Style**: Premium SaaS — spacious, clean tables, professional charts, trust badges

## Phase 1 — Foundation & Landing

### 1. i18n Setup
- React i18next with English + Arabic translations
- RTL support with direction switching
- Language switcher in header
- Localized dates, numbers, currencies (SAR/USD)

### 2. Landing Page
- Hero banner with animated gradient
- "Request Support", "Join as Consultant", "Explore Services" CTAs
- SAP support categories grid (S/4HANA, MM, SD, PP, Fiori, BTP, etc.)
- How it works — 4-step visual flow
- Why choose Qurtuba section
- Industries served (Oil & Gas, Banking, Retail, Healthcare, etc.)
- Featured consultants carousel with trust badges
- AI-enabled service delivery section
- Pricing/packages overview
- Client testimonials
- FAQ accordion
- Contact / Request Demo form (CRM-ready lead capture)
- Footer with links

### 3. Authentication
- Sign up (email/password) with role selection (Client/Consultant)
- Login page
- Forgot password flow with reset page
- Role-based onboarding wizard
- Profile completion reminder
- Supabase Auth with RLS, user_roles table

### 4. Database Schema (Supabase)
- Users, user_roles, profiles, clients, consultants
- Skills, certifications, availability_slots
- Tickets, sessions, projects, milestones
- Messages, attachments
- Payments, payouts, invoices
- Ratings, notifications, audit_logs
- Knowledge base articles
- RLS policies for all tables

## Phase 2 — Client Portal

### 5. Client Dashboard
- KPI cards: Open tickets, Active sessions, Pending payments, Support history
- Recommended consultants widget
- Recent activity feed
- Quick actions: New request, Browse consultants

### 6. Support Request Wizard
- Step-by-step wizard: Module → Issue type → Description → Urgency → Attachments → Preferences
- AI triage assistant (suggests category & priority)
- Support request templates by SAP module
- All 20+ SAP categories preloaded

### 7. Consultant Marketplace
- Searchable/filterable consultant directory
- Consultant cards with photo, rating, badges, hourly rate, availability
- Comparison view (side-by-side)
- Save favorites
- "Best Match", "Fastest Available", "Budget Fit" AI recommendations

### 8. Booking & Scheduling
- Book instant or scheduled consultation
- Calendar picker with consultant availability
- Session type selection (chat, video, screen share)
- Booking confirmation with reminders

### 9. Client Invoices & Payments
- Invoice list with status badges
- Downloadable PDF invoices (VAT-ready)
- Payment history
- Secure checkout UI (Stripe-ready)

## Phase 3 — Consultant Portal

### 10. Consultant Dashboard
- Earnings overview, active cases, pending reviews
- Session calendar with availability management
- Wallet / payout section
- Performance summary with charts

### 11. Consultant Profile Management
- Edit profile: skills, certifications, industries, languages, rates, timezone
- Upload CV, certifications, profile video, references
- Verification status workflow
- AI skills evaluation score panel

### 12. Case Management
- Active support requests assigned
- Case history with timeline view
- Internal notes, attachments
- Knowledge base contribution area

## Phase 4 — Admin Portal

### 13. Admin Dashboard
- Revenue, response time, session conversion, ticket resolution rate
- Consultant utilization, customer satisfaction, verification rates
- KPI cards with trend indicators
- Charts: revenue trends, support volume by module, user growth

### 14. User & Consultant Management
- User list with filters, search, role management
- Consultant approval/rejection/suspension workflow
- Verification management page

### 15. Ticket Management
- Full ticket list with Kanban view option
- Ticket lifecycle: New → Under Review → Matched → In Progress → Waiting → Resolved → Closed
- SLA tracking with overdue alerts
- Escalation rules, recurring issue detection

### 16. Platform Configuration
- Support categories management
- Pricing logic configuration
- Promo codes / subscription plans
- System announcements
- Localization content management

### 17. Reports & Export
- Export reports to CSV/Excel
- Audit logs viewer
- Moderation tools for chat/session records

## Phase 5 — Communication & Collaboration

### 18. Real-Time Chat
- 1:1 chat between client and consultant
- Typing indicators, read receipts
- File sharing, voice notes
- Quick action templates for SAP responses
- Chat search and message history
- Admin moderation controls

### 19. Video/Voice & Session Room
- Embedded video meeting UI
- Voice calls, screen sharing
- Session timer with time tracking
- Meeting notes area
- AI transcription & summary placeholder
- Action items after meeting
- Recording storage UI

## Phase 6 — AI & Intelligence

### 20. AI Matching Engine
- Smart matching algorithm UI showing match scores
- Matching criteria: module expertise, rating, response time, availability, language, rate
- "Best Match", "Fastest Available", "Budget Fit" tabs

### 21. AI Copilot Widget
- Floating AI assistant across the portal
- Help and recommendations
- Issue classification assistant
- Suggested SAP notes / root cause areas

### 22. AI Analytics
- Sentiment scoring for interactions
- Risk alerts for delayed tickets
- Upsell recommendations (AMS, enhancements, integrations)
- Customer health score for enterprise accounts

## Phase 7 — Knowledge Base & Extras

### 23. Knowledge Base
- Searchable article directory
- Categories by SAP module
- Suggested articles before ticket submission
- Consultant-authored content
- Trending topics

### 24. Notifications System
- In-app notification center
- Bell icon with badge count
- Notification types: tickets, matches, bookings, payments, verification

### 25. Global Features
- Command bar / global smart search
- Dark mode toggle
- CSAT and NPS survey widgets
- Consultant gamified badges (Fast Responder, SAP FI Expert, Top Rated, Arabic Specialist)
- Emergency support request button
- "Book a Discovery Call" flow
- Enterprise account management page
- Project workspace with milestones & document vault

## Technical Notes
- All pages responsive (desktop + mobile)
- Mock data throughout for demo readiness
- Supabase for auth, database, storage, edge functions
- i18next for EN/AR with RTL support
- Recharts for analytics charts
- Component architecture with reusable cards, tables, filters, modals, tabs, status badges
