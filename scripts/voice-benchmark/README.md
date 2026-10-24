# Speech-to-text benchmark

Measures which speech model hears our consultants best, using 40 fixed sentences (`sentences.json`): SAP-heavy English,
Egyptian Arabic, Gulf Arabic, mixed Arabic/English, numbers and T-codes. No real user audio is used.

## Owner: record the sentences (about 10 minutes)

1. Use the headset or laptop microphone consultants usually use, in a normal room.
2. Record each sentence once, naturally (not too slowly), in the dialect shown. Save as `01.m4a`, `02.m4a` … `40.m4a`
   (any format: phone voice memos, `.wav`, `.mp3`, `.m4a`, `.webm`).
3. Ideally a second speaker (other accent) records into another folder.
4. Put the folders in Files or send them to the developer. Recordings stay outside the app and are never uploaded to it.

## Run

```bash
LOVABLE_API_KEY=… bun scripts/voice-benchmark/run.ts --audio ./recordings/speaker1 --out ./report-speaker1
```

Options: `--configs "Gemini alone|GPT alone + SAP hints"` (default: all seven configurations, see run.ts) ·
`--only 01,25` · `--concurrency 3` · `--tts <dir>` (synthetic voices instead of recordings: compares models, does not
measure real accents). Needs `ffmpeg`.

Output: `report.md` (WER per model, with/without vocabulary hints, per category, wait time, credits per minute, worst
sentences) and `results.csv` (every transcription).

## Deciding

Pick the model with the lowest **WER corrected** on the owner's recordings, then set it as the primary model in
Admin › AI Interviewer Training › Voice; the other becomes the second opinion. Re-run after any model change.
