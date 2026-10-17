export interface FoundingAward { consultant_id: string; founding_number: number | null; awarded_at: string; revoked_at: string | null }
export function activeAward(award?: FoundingAward): boolean {
  return !!award && award.revoked_at === null && Number.isInteger(award.founding_number) && Number(award.founding_number) > 0;
}
export function nextFoundingNumber(enabled: boolean, limit: number, used: number[]): number | null {
  if (!enabled) return null;
  for (let n = 1; n <= limit; n++) if (!used.includes(n)) return n;
  return null;
}
export function shouldAutomaticallyAward(status: string, previous: string | null, hasAwardHistory: boolean): boolean {
  return status === 'verified' && previous !== 'verified' && !hasAwardHistory;
}
export function boostActive(award: FoundingAward | undefined, months: number, now: number): boolean {
  if (!activeAward(award) || !award || months <= 0) return false;
  const start = new Date(award.awarded_at);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + months);
  return now >= start.getTime() && now < end.getTime();
}
export function foundingTieBreak(a?: FoundingAward, b?: FoundingAward, months = 0, now = Date.now()): number {
  return Number(boostActive(b, months, now)) - Number(boostActive(a, months, now));
}
