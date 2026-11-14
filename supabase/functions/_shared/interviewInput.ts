// Transcript replay includes the model's own replies, which can exceed a candidate answer.
export const INTERVIEW_MESSAGE_CHAR_LIMIT = 16000;
export const INTERVIEW_MESSAGE_COUNT_LIMIT = 80;
export function validInterviewMessage(value: string): boolean {
  return value.length <= INTERVIEW_MESSAGE_CHAR_LIMIT;
}