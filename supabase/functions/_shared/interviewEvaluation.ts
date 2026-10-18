export function validateInterviewEvaluation(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid interview evaluation');
  const row = value as Record<string, unknown>;
  for (const key of ['technical_score', 'soft_skills_score', 'overall_score']) {
    const score = row[key];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) throw new Error('Invalid interview score');
  }
  if (typeof row.summary !== 'string' || !row.summary.trim()) throw new Error('Missing interview summary');
  return { ...row, technical_score: Math.round(Number(row.technical_score)), soft_skills_score: Math.round(Number(row.soft_skills_score)), overall_score: Math.round(Number(row.overall_score)), summary: row.summary.trim() };
}

export function hasInterviewAnswers(messages: { role: string; content: string }[]): boolean {
  let question = false;
  let answers = 0;
  for (const message of messages) {
    if (!message.content.trim()) continue;
    if (message.role === 'assistant') question = true;
    else if (message.role === 'user' && question) { answers++; question = false; }
  }
  return answers >= 3;
}