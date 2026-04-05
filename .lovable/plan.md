## AI Avatar Recruitment Interview

### Overview
When a consultant joins, they go through an AI-powered video avatar interview that assesses both SAP technical skills and soft skills. Results auto-populate their profile skills and notify admins.

### Architecture

**1. Database Changes**
- `interview_sessions` table: stores interview metadata (consultant_id, status, overall_score, started_at, completed_at)
- `interview_answers` table: stores each Q&A pair (interview_id, question, answer_transcript, category, score, ai_feedback)
- Add `interview_status` enum: `pending`, `in_progress`, `completed`, `reviewed`

**2. AI Interview Edge Function** (`ai-interview`)
- Uses Lovable AI to generate contextual SAP interview questions
- Scores answers in real-time
- Returns final assessment with skill scores

**3. Voice Interaction** (ElevenLabs)
- Requires `ELEVENLABS_API_KEY` secret
- ElevenLabs Conversational AI agent for real-time voice interview
- Animated avatar on screen synced with speech

**4. Interview Flow**
1. Consultant clicks "Start Interview" during onboarding
2. AI avatar introduces itself, explains the process
3. 8-10 questions: mix of SAP technical + soft skills
4. Real-time speech-to-text for answers
5. AI scores each answer
6. Summary screen with results
7. Skills auto-added to `consultant_skills` table
8. Admin notification created

**5. UI Components**
- `InterviewRoom.tsx` — main interview screen with avatar, transcript, progress
- `InterviewResult.tsx` — results summary with skill breakdown
- Integration into consultant onboarding flow

### Implementation Order
1. Database migration (tables + enum)
2. Set up ElevenLabs API key
3. Build AI interview edge function
4. Build interview UI components
5. Integrate into onboarding flow
6. Auto-populate skills + notify admin