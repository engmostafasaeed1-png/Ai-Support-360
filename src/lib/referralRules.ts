/**
 * Feature Z "Programme rules" hub: pure helpers (checklist, journey, simulator). Every programme number comes from the
 * live settings passed in; nothing here is a programme rule of its own. Official money is still computed only in the
 * database - the simulator is an illustration.
 */
import { DEFAULT_TIERS, MAN_DAY_HOURS, rewardForFee, round2, tierFor, type Tier } from './referrals';

// ------------------------------------------------------------------ prerequisites checklist

export type CheckState = 'done' | 'todo' | 'locked';
export type CheckId = 'profile' | 'interview' | 'terms' | 'verified' | 'policy' | 'payout';

export interface ChecklistInput {
  profileSubmitted: boolean;
  interviewPassed: boolean;
  bestScore: number | null;
  passMark: number;
  acknowledged: boolean;
  verified: boolean;
  policy: boolean;
  payoutDetails: boolean;
  suspended: boolean;
}

export interface CheckItem { id: CheckId; state: CheckState; required: boolean }

export interface Checklist { items: CheckItem[]; active: boolean; left: number; suspended: boolean }

/**
 * Required: profile submitted, AI interview passed (score >= pass mark), terms acknowledged (locked until the interview is
 * passed - the same order as sharing), verified account, Consultant Service Policy. Payout details are needed to be
 * PAID, not to share, so they never block the programme.
 */
export function referralChecklist(i: ChecklistInput): Checklist {
  const items: CheckItem[] = [
    { id: 'profile', state: i.profileSubmitted ? 'done' : 'todo', required: true },
    { id: 'interview', state: i.interviewPassed ? 'done' : 'todo', required: true },
    { id: 'terms', state: i.acknowledged ? 'done' : i.interviewPassed ? 'todo' : 'locked', required: true },
    { id: 'verified', state: i.verified ? 'done' : 'todo', required: true },
    { id: 'policy', state: i.policy ? 'done' : 'todo', required: true },
    { id: 'payout', state: i.payoutDetails ? 'done' : 'todo', required: false },
  ];
  const left = items.filter((x) => x.required && x.state !== 'done').length;
  return { items, left, suspended: i.suspended, active: left === 0 && !i.suspended };
}

// ------------------------------------------------------------------ the 5-step journey

export type JourneyStep = 'share' | 'register' | 'activate' | 'paid' | 'earn';
export const JOURNEY: JourneyStep[] = ['share', 'register', 'activate', 'paid', 'earn'];

export interface JourneyInput { clicks: number; signups: number; activePairs: number; paying: number; lifetime: number }

/** Each step is done when the consultant's own data shows it; `current` is the first step not done (5 = all done). */
export function journeyProgress(i: JourneyInput): { done: Record<JourneyStep, boolean>; current: number } {
  const done: Record<JourneyStep, boolean> = {
    share: i.clicks > 0 || i.signups > 0,
    register: i.signups > 0,
    activate: i.activePairs > 0,
    paid: i.paying > 0,
    earn: i.lifetime > 0,
  };
  const idx = JOURNEY.findIndex((s) => !done[s]);
  return { done, current: idx === -1 ? JOURNEY.length : idx };
}

// ------------------------------------------------------------------ simulator

export const SIM_MAX_REFERRED = 60;
export const SIM_MAX_MAN_DAYS = 22;
export const SIM_MAX_MONTHS = 12;

export interface SimSettings {
  tiers: Tier[];
  months: number;
  minInvoice: number;
  monthlyCap: number | null;
  monthlyCapReferred: number | null;
  maxPerReferred: number | null;
}

export interface SimInput {
  /** Referred consultants who are verified and paying (0-60); the tier is chosen from this number. */
  referred: number;
  /** Average man-days per referred consultant per month (0-22). */
  manDays: number;
  hourlyRate: number;
  /** Months of the window shown (1 to the programme months, at most 12). */
  months: number;
  /** Colleagues join gradually over the months instead of all at once. */
  rampUp: boolean;
}

export type SimNote = 'min_invoice' | 'cap_referrer' | 'cap_referred' | 'max_per_referred';

export interface SimResult {
  referred: number;
  months: number;
  tier: { name: string; rate: number };
  feePerReferralMonth: number;
  perReferralMonthly: number;
  perReferralWindow: number;
  monthly: number;
  windowTotal: number;
  totalFeeBase: number;
  series: Array<{ month: number; active: number; rate: number; reward: number; cumulative: number }>;
  next: { name: string; rate: number; min: number; needed: number; monthlyAtNext: number; extraMonthly: number } | null;
  notes: SimNote[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/** Months the simulator may show: the programme window, never more than 12. */
export const simMonths = (settingsMonths: number) => clamp(Math.round(settingsMonths || 0), 1, SIM_MAX_MONTHS);

/**
 * Illustration of the reward rule: fee = man-days x 8 h x hourly rate per referred consultant and month, reward = tier
 * rate of that fee (2 decimals, like a reward line), tier chosen from the number of referrals (each month from the
 * colleagues active that month when ramping up). Invoice lines below the minimum earn nothing; caps are shown as notes
 * (in the real programme the reward is held for review, not cut).
 */
export function simulateReferrals(input: SimInput, s: SimSettings): SimResult {
  const tiers = s.tiers.length ? s.tiers : DEFAULT_TIERS;
  const n = Math.floor(clamp(input.referred, 0, SIM_MAX_REFERRED));
  const d = clamp(input.manDays, 0, SIM_MAX_MAN_DAYS);
  const h = clamp(input.hourlyRate, 0, 100000);
  const months = Math.round(clamp(input.months, 1, simMonths(s.months)));
  const fee = round2(d * MAN_DAY_HOURS * h);
  const belowMin = fee > 0 && fee < s.minInvoice;
  const tier = tierFor(n, tiers);
  const perRef = (rate: number) => (belowMin ? 0 : rewardForFee(fee, rate));
  const perReferralMonthly = perRef(tier.rate);

  const series: SimResult['series'] = [];
  let cumulative = 0;
  let feeBase = 0;
  for (let m = 1; m <= months; m++) {
    const active = input.rampUp ? Math.min(n, Math.ceil((n * m) / months)) : n;
    const rate = tierFor(active, tiers).rate;
    const reward = round2(perRef(rate) * active);
    cumulative = round2(cumulative + reward);
    feeBase = round2(feeBase + fee * active);
    series.push({ month: m, active, rate, reward, cumulative });
  }
  const monthly = round2(perReferralMonthly * n);
  const perReferralWindow = round2(perReferralMonthly * months);

  let next: SimResult['next'] = null;
  if (tier.next) {
    const monthlyAtNext = round2(perRef(tier.next.rate) * tier.next.min);
    next = {
      name: tier.next.name, rate: tier.next.rate, min: tier.next.min, needed: tier.next.min - n,
      monthlyAtNext, extraMonthly: round2(monthlyAtNext - perRef(tier.rate) * tier.next.min),
    };
  }

  const notes: SimNote[] = [];
  if (belowMin) notes.push('min_invoice');
  if (s.monthlyCap != null && series.some((x) => x.reward > (s.monthlyCap as number))) notes.push('cap_referrer');
  if (s.monthlyCapReferred != null && perReferralMonthly > s.monthlyCapReferred) notes.push('cap_referred');
  if (s.maxPerReferred != null && perReferralWindow > s.maxPerReferred) notes.push('max_per_referred');

  return {
    referred: n, months, tier: { name: tier.name, rate: tier.rate }, feePerReferralMonth: fee, perReferralMonthly, perReferralWindow,
    monthly, windowTotal: cumulative, totalFeeBase: feeBase, series, next, notes,
  };
}

/** Starting hourly rate: the consultant's own rate, else the platform average, else empty (the person types one). */
export const simDefaultRate = (d: { own_rate: number | null; platform_rate: number | null }) => d.own_rate ?? d.platform_rate ?? null;

export interface RealReferralRow { activation_status: string; first_paid_at: string | null; window_ends_at: string | null; man_days: number }

/**
 * "Use my real numbers" from referral_calc_referrals (the same RPC as the calculations page): referrals that are active
 * and have a paid ticket, and their average approved man-days per month since the first paid ticket. The hourly rate of
 * referred consultants is never derived (privacy); it stays the consultant's own / platform figure.
 */
export function realNumbersFromReferrals(rows: RealReferralRow[], now = new Date()): { referred: number; manDays: number } {
  const paying = rows.filter((r) => r.activation_status === 'active' && r.first_paid_at);
  if (!paying.length) return { referred: 0, manDays: 0 };
  let days = 0;
  let monthsTotal = 0;
  for (const r of paying) {
    const start = new Date(r.first_paid_at as string).getTime();
    const end = Math.min(now.getTime(), r.window_ends_at ? new Date(r.window_ends_at).getTime() : now.getTime());
    monthsTotal += Math.max(1, Math.ceil((end - start) / (30.4375 * 86_400_000)));
    days += Number(r.man_days) || 0;
  }
  return { referred: Math.min(SIM_MAX_REFERRED, paying.length), manDays: Math.round(clamp(days / monthsTotal, 0, SIM_MAX_MAN_DAYS) * 10) / 10 };
}
