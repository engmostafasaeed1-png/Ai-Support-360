# Discussion-style interviews

Add four new ways to run a consultant interview, chosen when the interview starts. The current question-by-question interview stays as "Standard Q&A".

## What consultants and admins will see

A "Interview style" picker before the disclaimer, with five options:

1. **Standard Q&A** — today's flow (question bank, one follow-up).
2. **Open discussion (AI)** — Ezz/Mariam holds a natural conversation, picks up on what the consultant says, digs deeper, and covers the consultant's SAP areas without a fixed list.
3. **Scenario discussion (AI)** — Ezz presents a realistic SAP problem (e.g. "month-end close fails in FI after an S/4 upgrade") and walks through diagnosis and solution step by step, adding twists as the consultant answers. 2–3 scenarios per interview.
4. **AI panel** — 2–3 AI interviewers in the same conversation (e.g. Ezz as functional lead, Mariam as technical architect, a third as project manager). Each message shows who is speaking, with their own avatar and voice.
5. **Live human interview** — an admin (or invited senior consultant) interviews the candidate in a live chat room inside the app, with text and voice notes. Optionally an AI "co-pilot" can join to suggest questions to the human interviewer (only the interviewer sees them).

Voice-first replies, typing, scoring and the "Submitted for review" ending work the same in every AI style. Scoring takes the full discussion into account.

## Live human interview flow

- Admin opens a consultant on the approvals page → "Schedule live interview" → picks a time and the interviewer(s) (one or more = human panel).
- Consultant sees it under AI Interviews → "Join live interview" at the scheduled time.
- Both sides chat in real time; interviewer gets a private notes box and a 1–5 score sheet per skill, then marks it complete. The result appears in the consultant's interview history like AI interviews.

## Technical details

- Database: add `interview_style` text column to `interview_sessions` (`standard | discussion | scenario | panel | live`), plus `interview_participants` (session_id, user_id, role interviewer/candidate) and `interview_messages` (session_id, sender_id, content, is_private, created_at) with grants + RLS scoped to participants and admins; realtime enabled on `interview_messages`.
- Edge function `ai-interview-chat`: accept `style`; separate system prompts for discussion / scenario / panel. Panel replies tag each turn with `[[speaker: Name|role]]`, parsed like the existing `[[by: ...]]` author tag. Existing model kept as-is.
- `AIInterviewFlow`: style picker step; speaker label + avatar per panel message; per-speaker TTS voice.
- New `LiveInterviewRoom` component (realtime chat, private notes, score sheet) and admin "Schedule live interview" dialog; consultant `InterviewsPage` lists live interviews.
- Verify: run one AI interview in each style end to end and one live interview with two signed-in users, then clean up test data.
