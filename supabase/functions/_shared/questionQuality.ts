// Interviewer-side learning: how each interview question performs (docs/sql/interview-voice-learning.sql:
// voice_learning_nightly fills interview_question_stats with the same answer classes and flags). Pure, tested.
// Questions are only flagged once enough candidates answered them; a flag is a hint for the administrator, never an
// automatic change: retiring, editing or adding a question to the library always needs an administrator.

export type AnswerClass = "answer" | "skip" | "confusion";

const SKIP = /^(skip|pass|next( question)?|no idea|not sure|i (do not|don'?t) know|no comment|لا ?أعرف|لا ?اعرف|مش عارف|معرفش|ما ?اعرف|ما ?أعرف|التالي|تخطي|السؤال التالي)[\s.!،]*$/i;
const CONFUSION = /\b(i (do not|don'?t) (understand|get) (the|your|this|what)|(can|could) you (please )?(repeat|rephrase|clarify|explain the question)|what do you mean|(the )?question is (not clear|unclear)|not sure what you (mean|are asking)|pardon\??$)|مش فاهم|ما ?فهمت|لم أفهم|لم افهم|ممكن تعيد|ممكن توضح|تقصد ايه|تقصد إيه|يعني ايه السؤال|أعد السؤال|اعد السؤال|كرر السؤال|السؤال مش واضح|السؤال غير واضح/i;

/** Same patterns as the database (voice_answer_class). */
export function classifyAnswer(text: string | null | undefined): AnswerClass {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || SKIP.test(t)) return "skip";
  if (CONFUSION.test(t)) return "confusion";
  return "answer";
}

export interface QuestionStats {
  answers: number; skips: number; confusions: number; avg_score: number | null; voice_answers: number; edited: number; avg_answer_ms: number | null;
  from_library?: boolean;
}

export type QuestionFlag = "misunderstood" | "skipped" | "low_score" | "hard_to_transcribe";

export function questionFlags(s: QuestionStats, cfg: { question_min_answers: number; question_flag_rate: number }): QuestionFlag[] {
  if (s.answers < cfg.question_min_answers) return [];
  const out: QuestionFlag[] = [];
  if (s.confusions / s.answers >= cfg.question_flag_rate) out.push("misunderstood");
  if (s.skips / s.answers >= cfg.question_flag_rate) out.push("skipped");
  if (s.avg_score != null && s.avg_score < 30) out.push("low_score");
  if (s.voice_answers >= cfg.question_min_answers && s.edited / s.voice_answers >= 0.6) out.push("hard_to_transcribe");
  return out;
}

/** A good generated question an administrator may add to the library: clear, rarely skipped, separates candidates. */
export function libraryCandidate(s: QuestionStats, cfg: { question_min_answers: number }): boolean {
  if (s.from_library || s.answers < cfg.question_min_answers || s.avg_score == null) return false;
  return s.confusions / s.answers < 0.15 && s.skips / s.answers < 0.15 && s.avg_score >= 40 && s.avg_score <= 85;
}

export const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export interface RewriteHint { key: string; text: string }

/** Rule-based rewrite suggestions for a flagged question (the administrator writes the new wording). */
export function rewriteHints(question: string, flags: readonly QuestionFlag[]): RewriteHint[] {
  const q = String(question ?? "").trim();
  const words = q.split(/\s+/).filter(Boolean).length;
  const out: RewriteHint[] = [];
  const add = (key: string, text: string) => { if (!out.some((h) => h.key === key)) out.push({ key, text }); };
  if (words > 35) add("shorten", `Shorten it: ${words} words is long to follow when spoken. Aim for under 25.`);
  if ((q.match(/[?؟]/g) ?? []).length > 1) add("one_question", "Ask one thing at a time: it contains several questions.");
  if (/\b(explain everything|tell me (all|everything) about|talk about)\b/i.test(q)) add("specific", "Ask for one concrete case instead of a broad topic.");
  if (/\bnot\b[^.?]*\bnot\b|\bunless\b[^.?]*\bnot\b/i.test(q)) add("negative", "Avoid double negatives; ask it positively.");
  const acronyms = (q.match(/\b[A-Z]{2,6}\b/g) ?? []).filter((a) => !["SAP", "ECC", "AI"].includes(a));
  if (new Set(acronyms).size >= 3) add("acronyms", "Too many abbreviations in one sentence; spell out at least one.");
  if (flags.includes("misunderstood")) add("scenario", "Candidates often ask what is meant: add a short business scenario (company, process, the problem).");
  if (flags.includes("skipped")) add("difficulty", "Often skipped: lower the difficulty or split it into a warm-up and a follow-up.");
  if (flags.includes("low_score")) add("key_points", "Very low average score: check that the expected key points match the question and the level.");
  if (flags.includes("hard_to_transcribe")) add("terms", "Answers are often corrected by hand: the expected terms may be hard to hear; add them to the voice vocabulary.");
  return out;
}

/** "This question is misunderstood by 40 % of candidates" style summary. */
export function flagSentence(flag: QuestionFlag, s: QuestionStats): string {
  switch (flag) {
    case "misunderstood": return `This question is misunderstood by ${rate(s.confusions, s.answers)} % of candidates.`;
    case "skipped": return `${rate(s.skips, s.answers)} % of candidates skip this question.`;
    case "low_score": return `Average score is only ${Math.round(s.avg_score ?? 0)} of 100.`;
    case "hard_to_transcribe": return `${rate(s.edited, s.voice_answers)} % of spoken answers were corrected by hand.`;
  }
}
