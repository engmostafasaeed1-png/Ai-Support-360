# Interview voice: server speech-to-text

Status: **built, database part prepared but not applied.** Until `docs/sql/interview-voice.sql` is applied, the
`voice-transcribe` function answers "not ready" and every microphone keeps using the browser's own recogniser
(with the improvements listed under "Browser fallback").

## How it works

1. The browser records the microphone with echo cancellation, noise suppression and automatic gain
   (`src/lib/voice/micRecorder.ts`) and cuts it into short, complete 16 kHz mono WAV pieces at natural pauses
   (`segmenter.ts`, at most 30 s each). While the AI interviewer speaks or thinks, nothing is recorded.
2. Each piece goes to the signed-in `voice-transcribe` function while the person keeps talking. The function checks the
   caller, the interview owner and status, size, format and exact length (read from the WAV header), claims the minutes
   atomically in the database, then sends the audio to the AI gateway speech model with hints:
   - SAP vocabulary built from the consultant's profile modules and releases, the interviewer's current question and the
     interview plan from the knowledge base (`_shared/voiceGlossary.ts`, max 50 terms);
   - a short prompt saying the answer may mix English and Arabic (Egyptian, Gulf, Levantine) and keep SAP terms in Latin script;
   - language hints: the interview language plus English and Arabic.
3. The text comes back, SAP spellings are fixed ("ac doca" → "ACDOCA", "s4 hana" → "S/4HANA"; only spelling and capitals
   change, the raw text is kept for the audit), and pieces are put back in spoken order (`transcriptAssembler.ts`).
4. The text is placed in the answer box. Hands-free mode sends it after 2 seconds of silence once every piece is back;
   a thinking pause in the middle of an answer no longer cuts it. The person can always edit before sending.

One recogniser (`src/hooks/useVoiceRecognizer.ts`) serves every microphone: AI interview, live interview, ticket title and
description, chat, proposal cover letter (`src/components/ui/voice-input.tsx`). Dictation fields now add spoken text after
what was typed instead of repeating it.

## Browser fallback

Used automatically when the server is off, not applied, over a limit, rate-limited or failing. It now restarts itself after
the browser's own short-pause stop, maps "ar" to Egyptian Arabic and "ar-SA" to Saudi Arabic, shows interim text and tells
the person when it is in use. Firefox (no browser recogniser) gets voice through the server engine.

## Model and cost

- Model: `openai/gpt-transcribe` (current, transcription endpoint, zero data retention at the provider).
- Price: 0.0003 workspace credits per audio second = **0.018 credits per audio minute** (gateway model listing, 2026-10-24).
  A 30-minute interview with about 15 minutes of speaking ≈ 0.27 credits. The admin Voice tab shows minutes and an estimate.
- Measured on test recordings: about 0.9 s per 15-second piece.
- No extra secret: the function uses the existing `LOVABLE_API_KEY` backend secret.

## Limits (admin › AI Interviewer Training › Voice)

| Setting | Default | Range |
|---|---|---|
| Server transcription | on | – |
| SAP spelling fixes | on | – |
| Keep interview audio | **off** | – |
| Audio minutes per interview | 40 | 5–120 |
| Audio minutes per person per 24 h (all voice) | 90 | 10–480 |
| Dictation minutes per person per 24 h | 20 | 0–120 |
| Longest piece | 30 s | 10–30 s |

Also 40 uploads per minute per person (function rate limit). Over a limit, the answer continues with the browser recogniser.

## Privacy

- Audio is processed in memory and sent only to the gateway speech model. It is **not stored** unless an administrator
  turns on "Keep interview audio" (then it goes to the private `interview-audio` storage, service role only; create the
  bucket at the same time). Dictation audio is never stored.
- Stored per piece: length, wait time, language, status, error code and, for interviews only, the raw transcript and the
  list of SAP spelling fixes (admin audit). Dictation text is never stored. Per answer: engine, fallback reason, number of
  pieces, edited yes/no, length. No audio, no text in logs, no e-mail addresses.
- Consultants see a notice before the interview (`VoiceConsentNote`).

Suggested privacy-policy wording (for the owner and lawyer to review, not published automatically):

> **Voice answers in AI interviews.** If you choose to answer by voice, your recording is sent to an AI speech service
> that turns it into text so the AI interviewer can read it. Recordings are processed only for this purpose and are not
> stored by us or by the service provider, unless we tell you otherwise before the interview. The written text of your
> answers is stored with your interview and used to evaluate it. You can always type your answers instead.

## Checks

SQL (scratch database, after applying the file): `docs/sql/interview-voice.test.sql`

| Test | What it proves |
|---|---|
| V01 | Anonymous visitors cannot call any voice function |
| V02 | Signed-in users cannot claim minutes, finish pieces or read settings directly |
| V03 | No browser access to the voice tables |
| V04 | Interview minute cap refuses the piece over the limit |
| V05 | Failed pieces free their minutes; a piece is finished only once |
| V06 | 24-hour cap across interviews and dictation |
| V07 | Dictation cap and the off switch |
| V08 | Over-long pieces and bad requests are refused |
| V09 | Dictation text is never stored |
| V10 | Answer records only for your own interview, valid values only |
| V11 | Metrics and audit are administrators only |
| V12 | Administrators see per-interview numbers and the audit trail |

App tests: `src/lib/voice/voiceServer.test.ts`, `src/lib/voice/voiceClient.test.ts`.

## Manual test checklist (after applying the SQL)

1. Admin › AI Interviewer Training › Voice: the "not applied" notice is gone; settings save.
2. Start an AI interview as a consultant on Chrome: the microphone test shows the level bars and "We understood: …"
   with "Enhanced recognition"; say "I posted the invoice in MIRO and checked ACDOCA in S/4HANA".
3. In hands-free mode answer with a 1-second thinking pause in the middle: the answer is not cut; it is sent about
   2 seconds after you stop.
4. Answer in mixed Arabic and English: Arabic in Arabic script, SAP terms in Latin script.
5. Leave the speakers on (no headset): the interviewer's voice must not appear as your answer.
6. Block the microphone in the browser: a clear message, typing still works.
7. Set "Audio minutes per interview" to 5 and talk past it: the message about the voice limit appears and the browser
   recogniser continues.
8. Firefox: voice answers work (server engine).
9. Ticket form: dictate into the description after typing a sentence: the sentence is kept and the spoken text added once.
10. Admin › Voice: the interview appears with minutes, pieces and the raw text audit.
