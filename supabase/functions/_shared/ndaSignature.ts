// NDA signature + signer identity rules (docs/sql/nda-signature-identity.sql). Pure TypeScript, shared by the
// nda-signature edge function (server-side validation before anything is stored) and the web app (live form
// messages, tests). The database re-checks every value it can see (name, masked ID shape, country, image bytes,
// stroke metrics, rate limits); the full ID number never reaches the database in clear text.

export type NdaParty = 'client' | 'consultant';
export type IdType = 'national_id' | 'passport';
export type SignMethod = 'draw' | 'typed';

/** Admin settings (platform_settings 'nda_signature'); the database holds the official values. */
export const NDA_SIGNATURE_DEFAULTS = {
  allow_typed_signature: false,
  store_ip: false,
  id_retention_years: 5,
  reminder_hours: 24,
} as const;
export type NdaSignatureSettings = { -readonly [K in keyof typeof NDA_SIGNATURE_DEFAULTS]: (typeof NDA_SIGNATURE_DEFAULTS)[K] extends boolean ? boolean : number };

/** Signature pad in logical units (the pad scales any screen size to 600 x 200). */
export const SIGNATURE_RULES = {
  canvasWidth: 600,
  canvasHeight: 200,
  minPoints: 10,
  minLength: 150,
  minWidth: 60,
  minHeight: 15,
  maxPoints: 6000,
  maxStrokes: 60,
  pngMinBytes: 100,
  pngMaxBytes: 300_000,
  pngMinSide: 100,
  pngMaxSide: 2400,
} as const;

export const ID_RULES: Record<IdType, { min: number; max: number }> = {
  passport: { min: 6, max: 12 },
  national_id: { min: 5, max: 20 },
};

export const NDA_PDF_FOOTER = {
  en: 'Electronically signed in the AI Support 360 portal. Not a qualified electronic signature.',
  ar: 'وُقّع إلكترونيًا في بوابة AI Support 360. ليس توقيعًا إلكترونيًا مؤهلًا.',
} as const;

// ------------------------------------------------------------------ signature strokes

export interface Point { x: number; y: number }
export type Stroke = Point[];
export interface StrokeMetrics { strokes: number; points: number; length: number; width: number; height: number }

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Ink length and bounding box of the drawn strokes (logical 600 x 200 units). */
export function strokeMetrics(strokes: Stroke[]): StrokeMetrics {
  let points = 0, length = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let used = 0;
  for (const s of strokes) {
    if (!Array.isArray(s) || s.length === 0) continue;
    used++;
    for (let i = 0; i < s.length; i++) {
      const p = s[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const x = Math.min(Math.max(p.x, 0), SIGNATURE_RULES.canvasWidth);
      const y = Math.min(Math.max(p.y, 0), SIGNATURE_RULES.canvasHeight);
      points++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (i > 0 && s[i - 1]) {
        const q = s[i - 1];
        length += Math.hypot(x - Math.min(Math.max(q.x, 0), SIGNATURE_RULES.canvasWidth), y - Math.min(Math.max(q.y, 0), SIGNATURE_RULES.canvasHeight));
      }
    }
  }
  if (points === 0) return { strokes: 0, points: 0, length: 0, width: 0, height: 0 };
  return { strokes: used, points, length: round1(length), width: round1(maxX - minX), height: round1(maxY - minY) };
}

export type SignatureProblem = 'signature_empty' | 'signature_too_short' | 'signature_too_small' | 'signature_too_complex';

/** An empty pad, a dot, a tiny scribble or a flat line is not a signature. */
export function signatureProblems(m: StrokeMetrics): SignatureProblem[] {
  const r = SIGNATURE_RULES;
  if (!m || m.points === 0) return ['signature_empty'];
  const out: SignatureProblem[] = [];
  if (m.points > r.maxPoints || m.strokes > r.maxStrokes) out.push('signature_too_complex');
  if (m.points < r.minPoints || m.length < r.minLength) out.push('signature_too_short');
  if (m.width < r.minWidth || m.height < r.minHeight) out.push('signature_too_small');
  return out;
}

// ------------------------------------------------------------------ name, title, company

export function normaliseName(raw: string): string {
  return String(raw ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export type NameProblem = 'name_required' | 'name_too_long' | 'name_letters_only' | 'name_two_words';

/** Full legal name: at least two words, letters only (any script, incl. Arabic), hyphen / apostrophe / dot allowed. */
export function nameProblems(raw: string): NameProblem[] {
  const n = normaliseName(raw);
  if (!n) return ['name_required'];
  if (n.length > 120) return ['name_too_long'];
  if (!/^[\p{L}\p{M} '’.-]+$/u.test(n)) return ['name_letters_only'];
  const words = n.split(' ').filter((w) => /\p{L}/u.test(w));
  const letters = n.replace(/[^\p{L}]/gu, '').length;
  if (words.length < 2 || letters < 3) return ['name_two_words'];
  return [];
}

/** Same pattern as the database fallback (sa_text_ok): e-mail addresses, links and phone numbers. */
export function hasContactDetails(raw: string): boolean {
  const t = String(raw ?? '');
  return /([a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,})|(https?:\/\/|www\.)|((\+|\b00)\d[\d\s().-]{7,}\d)/i.test(t);
}

export type TextProblem = 'required' | 'too_long' | 'contact';

export function shortTextProblems(raw: string, max: number): TextProblem[] {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 2) return ['required'];
  if (t.length > max) return ['too_long'];
  if (hasContactDetails(t)) return ['contact'];
  return [];
}

// ------------------------------------------------------------------ ID document

const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/** Upper case, Arabic-Indic digits to 0-9, spaces / hyphens / dots / slashes removed. */
export function normaliseIdNumber(raw: string): string {
  return String(raw ?? '')
    .replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10))
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s./-]/g, '');
}

export type IdProblem = 'id_type_required' | 'id_country_required' | 'id_country_invalid' | 'id_required' | 'id_format' | 'id_length' | 'id_needs_digit' | 'id_repeated';

/** ISO 3166-1 alpha-2 codes offered as issuing country (Israel is excluded from every country option). */
export const ISSUING_COUNTRIES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ ' +
  'OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ');

export function countryOk(code: string): boolean {
  const c = String(code ?? '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== 'IL' && ISSUING_COUNTRIES.includes(c);
}

/** Basic format and length per document type; valid foreign formats (letters + digits) pass. */
export function idProblems(type: IdType | '' | null | undefined, country: string, raw: string): IdProblem[] {
  if (type !== 'passport' && type !== 'national_id') return ['id_type_required'];
  if (!country) return ['id_country_required'];
  if (!countryOk(country)) return ['id_country_invalid'];
  const v = normaliseIdNumber(raw);
  if (!v) return ['id_required'];
  if (!/^[A-Z0-9]+$/.test(v)) return ['id_format'];
  const r = ID_RULES[type];
  if (v.length < r.min || v.length > r.max) return ['id_length'];
  if (!/\d/.test(v)) return ['id_needs_digit'];
  if (/^(.)\1+$/.test(v)) return ['id_repeated'];
  return [];
}

/** Masked form shown to the other party: first 2 + last 3 (shorter numbers show less, never everything). */
export function maskIdNumber(raw: string): string {
  const v = normaliseIdNumber(raw);
  const n = v.length;
  if (n === 0) return '';
  const [head, tail] = n >= 8 ? [2, 3] : n >= 6 ? [1, 2] : [1, 1];
  if (n <= head + tail) return '*'.repeat(n);
  return v.slice(0, head) + '*'.repeat(n - head - tail) + v.slice(n - tail);
}

/** Shape check of a stored masked value (the database runs the same test). */
export function maskedIdOk(type: IdType, masked: string): boolean {
  const r = ID_RULES[type];
  return !!r && /^[A-Z0-9]{1,2}\*+[A-Z0-9]{1,3}$/.test(masked) && masked.length >= r.min && masked.length <= r.max;
}

// ------------------------------------------------------------------ whole form

export interface SignFormInput {
  party: NdaParty;
  method: SignMethod;
  metrics: StrokeMetrics | null;
  typedSignature?: string;
  allowTyped: boolean;
  name: string;
  idType: IdType | '';
  idCountry: string;
  idNumber: string;
  authorised: boolean;
  agreed: boolean;
  jobTitle?: string;
  companyName?: string;
}

export type SignFormProblem = SignatureProblem | NameProblem | IdProblem | 'typed_not_allowed' | 'typed_required'
  | 'not_authorised' | 'not_agreed' | 'title_required' | 'title_too_long' | 'title_contact' | 'company_required' | 'company_too_long' | 'company_contact';

/** Every reason the Sign button stays disabled, in form order (empty = ready to sign). */
export function signFormProblems(f: SignFormInput): SignFormProblem[] {
  const out: SignFormProblem[] = [];
  if (f.method === 'typed') {
    if (!f.allowTyped) out.push('typed_not_allowed');
    else if (nameProblems(f.typedSignature ?? '').length) out.push('typed_required');
  } else {
    out.push(...signatureProblems(f.metrics ?? { strokes: 0, points: 0, length: 0, width: 0, height: 0 }));
  }
  out.push(...nameProblems(f.name));
  out.push(...idProblems(f.idType, f.idCountry, f.idNumber));
  if (f.party === 'client') {
    for (const p of shortTextProblems(f.jobTitle ?? '', 80)) out.push(p === 'required' ? 'title_required' : p === 'too_long' ? 'title_too_long' : 'title_contact');
    for (const p of shortTextProblems(f.companyName ?? '', 160)) out.push(p === 'required' ? 'company_required' : p === 'too_long' ? 'company_too_long' : 'company_contact');
  }
  if (!f.authorised) out.push('not_authorised');
  if (!f.agreed) out.push('not_agreed');
  return out;
}

// ------------------------------------------------------------------ image + hashing

/** Real PNG check: signature bytes, IHDR first, IEND last, sane size. SVG or any other type fails. */
export function pngInfo(bytes: Uint8Array): { ok: boolean; width: number; height: number; reason?: string } {
  const r = SIGNATURE_RULES;
  const bad = (reason: string) => ({ ok: false, width: 0, height: 0, reason });
  if (!bytes || bytes.length < r.pngMinBytes) return bad('too_small');
  if (bytes.length > r.pngMaxBytes) return bad('too_large');
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return bad('not_png');
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(12) !== 'IHDR') return bad('not_png');
  if (tag(bytes.length - 8) !== 'IEND') return bad('truncated');
  const u32 = (o: number) => ((bytes[o] << 24) >>> 0) + (bytes[o + 1] << 16) + (bytes[o + 2] << 8) + bytes[o + 3];
  const width = u32(16), height = u32(20);
  if (width < r.pngMinSide || height < 40 || width > r.pngMaxSide || height > r.pngMaxSide) return { ok: false, width, height, reason: 'bad_size' };
  return { ok: true, width, height };
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = String(b64 ?? '').replace(/^data:image\/png;base64,/, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------ status shown to the parties

export interface NdaEvidence {
  signature_id: string;
  kind: 'signature' | 'supplement';
  method: SignMethod;
  signer_name: string;
  job_title: string | null;
  company_name: string | null;
  id_type: IdType;
  id_country: string;
  id_masked: string;
  document_hash: string;
  image_sha256: string;
  signed_at: string;
  captured_at: string;
}
export interface NdaPartyStatus { signed_at: string | null; legacy: boolean; evidence: NdaEvidence | null }
export interface NdaStatus {
  available: boolean;
  nda_id: string | null;
  consultant_id: string | null;
  client_id: string | null;
  revoked_at: string | null;
  document_hash: string | null;
  my_party: NdaParty | 'admin' | null;
  consultant: NdaPartyStatus;
  client: NdaPartyStatus;
  last_reminder_at: string | null;
  reminder_hours: number;
}

export type NdaViewKind = 'none' | 'revoked' | 'sign' | 'waiting_other' | 'fully_signed';
export interface NdaView {
  kind: NdaViewKind;
  me: NdaParty | null;
  other: NdaParty | null;
  mySignedAt: string | null;
  canAddDetails: boolean;
  canRemind: boolean;
  nextReminderAt: string | null;
  legacy: NdaParty[];
}

/** What the signed-in party sees in the NDA box (ticket page, NDA agreements page, engagement checklist). */
export function ndaView(s: NdaStatus | null | undefined, now: number = Date.now()): NdaView {
  const empty: NdaView = { kind: 'none', me: null, other: null, mySignedAt: null, canAddDetails: false, canRemind: false, nextReminderAt: null, legacy: [] };
  if (!s) return empty;
  const me = s.my_party === 'client' || s.my_party === 'consultant' ? s.my_party : null;
  const other: NdaParty | null = me === 'client' ? 'consultant' : me === 'consultant' ? 'client' : null;
  const legacy = (['consultant', 'client'] as const).filter((p) => !!s[p].signed_at && s[p].legacy);
  if (s.nda_id && s.revoked_at) return { ...empty, kind: 'revoked', me, other, legacy };
  const cons = !!s.consultant.signed_at, cli = !!s.client.signed_at;
  let kind: NdaViewKind;
  if (cons && cli) kind = 'fully_signed';
  else if (!me) kind = 'none';
  else if (me === 'consultant') kind = cons ? 'waiting_other' : 'sign';
  else kind = cons ? 'sign' : 'waiting_other';
  const mySignedAt = me ? s[me].signed_at : null;
  const hours = Math.max(24, Number(s.reminder_hours) || NDA_SIGNATURE_DEFAULTS.reminder_hours);
  const last = s.last_reminder_at ? Date.parse(s.last_reminder_at) : NaN;
  const nextMs = Number.isFinite(last) ? last + hours * 3_600_000 : null;
  const canRemind = kind === 'waiting_other' && (nextMs === null || now >= nextMs);
  return {
    kind, me, other, mySignedAt,
    canAddDetails: !!me && !!mySignedAt && s[me].legacy,
    canRemind,
    nextReminderAt: kind === 'waiting_other' && nextMs !== null && now < nextMs ? new Date(nextMs).toISOString() : null,
    legacy,
  };
}

/** Earliest time the next reminder may go out (1 per reminder window, never below 24 h). */
export function nextReminderAllowedAt(lastIso: string | null, hours: number): string | null {
  if (!lastIso) return null;
  const last = Date.parse(lastIso);
  if (!Number.isFinite(last)) return null;
  return new Date(last + Math.max(24, hours) * 3_600_000).toISOString();
}
