## AI Interview Flow

### 1. Edge Function: `ai-interview-questions`
- Takes consultant's SAP modules/skills and generates 5-8 tailored interview questions using Lovable AI
- Returns questions with categories (technical, soft_skills, scenario)

### 2. Edge Function: `ai-interview-evaluate`  
- Takes questions + answers, evaluates them using AI
- Returns scores and feedback per answer, plus overall summary

### 3. New Component: `AIInterviewFlow.tsx`
- Full-screen interview experience for consultants
- Shows questions one at a time with a text area for answers
- Progress bar, timer, submit flow
- On completion, calls evaluate edge function and saves results

### 4. Update Consultant Verification Page
- When consultant has a pending AI interview, show a "Start AI Interview" button
- Links to the AI interview flow

### 5. Integration
- When ReinterviewDialog creates an AI-type interview, the consultant gets notified
- Consultant navigates to verification page → starts AI interview
- Questions auto-generated → consultant answers → AI evaluates → scores saved
