
# End-to-End Platform Integration Plan

## Phase 1: Auth & Profile Flow
- Wire signup to create `profiles` + `user_roles` + role-specific profiles (`client_profiles` or `consultants`)
- Wire login to fetch real profile data and route to correct dashboard based on role
- Replace mock profile data in dashboards with real Supabase queries
- Update sidebar user cards to show real avatar/name

## Phase 2: Client Dashboard & Tickets
- Replace `mockClientTickets` with real `tickets` table queries
- Wire "New Request" form to INSERT into `tickets` table
- Replace `mockClientSessions` with real `sessions` table queries  
- Replace `mockClientPayments` with real `payments` table queries
- Replace `mockRecommendedConsultants` with real `consultants` table queries
- Replace `mockActivityFeed` with real `notifications` table

## Phase 3: Consultant Dashboard & Profile
- Replace mock consultant data with real `consultants` + `consultant_skills` + `certifications` queries
- Wire consultant profile editing to UPDATE real records
- Wire availability slots to real `availability_slots` table
- Wire earnings/payouts to real `payments` + `payouts` tables

## Phase 4: Sessions & Chat
- Wire session booking (BookingModal) to INSERT into `sessions` table
- Connect chat to real `messages` table with realtime subscriptions
- Wire session detail page to real data

## Phase 5: Admin Dashboard
- Replace admin mock data with real aggregate queries
- Wire consultant approvals to real `consultants.verification_status` updates
- Wire ticket kanban to real `tickets` data

## Phase 6: Payments
- Wire payment records to real `payments` table
- Connect invoice generation to real data

## Approach
- Create shared hooks for each data domain (useTickets, useSessions, usePayments, etc.)
- Each hook handles loading, error, and empty states
- Preserve existing UI — only swap data source
