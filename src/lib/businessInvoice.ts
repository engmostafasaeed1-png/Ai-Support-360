/**
 * Business invoices: the business details of a company, the copy of them that an invoice carries,
 * the details of the seller, and everything the printable invoice page shows.
 * Pure functions, no network. The database checks the same rules again (save_tenant_billing_details,
 * admin_save_invoice_seller_details), so a rule that changes here must change there too.
 */

/* ------------------------------------------------------------------ business details of a company */

export const BILLING_LIMITS = {
  business_name: 200,
  tax_number: 50,
  commercial_registration: 50,
  address_line: 300,
  city: 100,
  country: 100,
  postal_code: 20,
  billing_email: 200,
  phone: 40,
  reference_note: 200,
} as const;

export type BillingField = keyof typeof BILLING_LIMITS;

export const BILLING_FIELDS = Object.keys(BILLING_LIMITS) as BillingField[];

export const BILLING_LABELS: Record<BillingField, string> = {
  business_name: 'The business name',
  tax_number: 'The tax number',
  commercial_registration: 'The commercial registration number',
  address_line: 'The address',
  city: 'The city',
  country: 'The country',
  postal_code: 'The postal code',
  billing_email: 'The billing e-mail',
  phone: 'The phone number',
  reference_note: 'The reference',
};

export type BillingForm = {
  issue_business_invoices: boolean;
  business_name: string;
  tax_number: string;
  commercial_registration: string;
  address_line: string;
  city: string;
  country: string;
  postal_code: string;
  billing_email: string;
  phone: string;
  reference_note: string;
};

export const EMPTY_BILLING_FORM: BillingForm = {
  issue_business_invoices: false,
  business_name: '',
  tax_number: '',
  commercial_registration: '',
  address_line: '',
  city: '',
  country: '',
  postal_code: '',
  billing_email: '',
  phone: '',
  reference_note: '',
};

export type BillingErrors = Partial<Record<BillingField, string>>;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Same cleaning as the database: trim, and turn every run of white space (line breaks too) into one space. */
export function cleanBillingText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 32 || (code >= 127 && code < 160)) return true;
  }
  return false;
}

export function normaliseBillingForm(form: BillingForm): BillingForm {
  const out: BillingForm = { ...form, issue_business_invoices: form.issue_business_invoices === true };
  for (const key of BILLING_FIELDS) out[key] = cleanBillingText(form[key]);
  return out;
}

/** Checks the form with the rules of the database. Empty result = the form can be saved. */
export function validateBillingForm(form: BillingForm): BillingErrors {
  const f = normaliseBillingForm(form);
  const errors: BillingErrors = {};
  for (const key of BILLING_FIELDS) {
    if (hasControlCharacter(f[key])) errors[key] = `${BILLING_LABELS[key]} contains a character that is not allowed`;
    else if (f[key].length > BILLING_LIMITS[key]) errors[key] = `${BILLING_LABELS[key]} can have at most ${BILLING_LIMITS[key]} characters`;
  }
  if (f.billing_email && !errors.billing_email && !EMAIL_RE.test(f.billing_email)) errors.billing_email = 'Enter a valid billing e-mail address';
  if (f.tax_number && !errors.tax_number && f.tax_number.length < 3) errors.tax_number = 'The tax number is too short';
  if (f.issue_business_invoices) {
    if (!errors.business_name && f.business_name.length < 2) errors.business_name = 'Enter the business name';
    if (!errors.address_line && f.address_line.length < 3) errors.address_line = 'Enter the address';
    if (!errors.country && f.country.length < 2) errors.country = 'Enter the country';
  }
  return errors;
}

export function hasBillingErrors(errors: BillingErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** The details are enough to put on an invoice: name, address and country (the database asks for the same three). */
export function billingDetailsComplete(form: Pick<BillingForm, 'business_name' | 'address_line' | 'country'>): boolean {
  return (
    cleanBillingText(form.business_name).length >= 2 &&
    cleanBillingText(form.address_line).length >= 3 &&
    cleanBillingText(form.country).length >= 2
  );
}

/** Turns a row of tenant_billing_details (or nothing) into form values. */
export function toBillingForm(row: Record<string, unknown> | null | undefined): BillingForm {
  if (!row) return { ...EMPTY_BILLING_FORM };
  const out: BillingForm = { ...EMPTY_BILLING_FORM, issue_business_invoices: row.issue_business_invoices === true };
  for (const key of BILLING_FIELDS) out[key] = String(row[key] ?? '');
  return out;
}

export function billingFormsEqual(a: BillingForm, b: BillingForm): boolean {
  const x = normaliseBillingForm(a);
  const y = normaliseBillingForm(b);
  return x.issue_business_invoices === y.issue_business_invoices && BILLING_FIELDS.every((key) => x[key] === y[key]);
}

/* ------------------------------------------------------------------ the copy on an invoice */

export type BuyerDetails = Record<BillingField, string>;

/** The business details copied on an invoice (jsonb). null when the invoice carries none. */
export function toBuyerDetails(raw: unknown): BuyerDetails | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out = {} as BuyerDetails;
  for (const key of BILLING_FIELDS) out[key] = cleanBillingText(r[key]);
  return out;
}

/** True when the copy on the invoice is exactly the saved business details of the company. */
export function buyerMatchesForm(buyer: BuyerDetails | null, form: BillingForm): boolean {
  if (!buyer) return false;
  const f = normaliseBillingForm(form);
  return BILLING_FIELDS.every((key) => buyer[key] === f[key]);
}

export type LabelValue = { label: string; value: string };

function addressLines(d: { address_line: string; city: string; postal_code: string; country: string }): string[] {
  const out: string[] = [];
  if (d.address_line) out.push(d.address_line);
  const cityLine = [d.city, d.postal_code].filter(Boolean).join(' ');
  if (cityLine) out.push(cityLine);
  if (d.country) out.push(d.country);
  return out;
}

export function buyerAddressLines(b: BuyerDetails): string[] {
  return addressLines(b);
}

export function buyerFacts(b: BuyerDetails): LabelValue[] {
  const out: LabelValue[] = [];
  if (b.tax_number) out.push({ label: 'Tax number', value: b.tax_number });
  if (b.commercial_registration) out.push({ label: 'Commercial registration', value: b.commercial_registration });
  if (b.billing_email) out.push({ label: 'E-mail', value: b.billing_email });
  if (b.phone) out.push({ label: 'Phone', value: b.phone });
  if (b.reference_note) out.push({ label: 'Your reference', value: b.reference_note });
  return out;
}

/* ------------------------------------------------------------------ the seller (the company that issues the invoices) */

export type SellerDetails = {
  legal_name: string;
  legal_name_ar: string;
  address_line: string;
  city: string;
  country: string;
  postal_code: string;
  commercial_registration: string;
  tax_number: string;
  email: string;
  phone: string;
  website: string;
  footer_note: string;
};

export type SellerField = keyof SellerDetails;

export const SELLER_LIMITS: Record<SellerField, number> = {
  legal_name: 200,
  legal_name_ar: 200,
  address_line: 300,
  city: 100,
  country: 100,
  postal_code: 20,
  commercial_registration: 50,
  tax_number: 50,
  email: 200,
  phone: 40,
  website: 200,
  footer_note: 500,
};

export const SELLER_FIELDS = Object.keys(SELLER_LIMITS) as SellerField[];

export const SELLER_LABELS: Record<SellerField, string> = {
  legal_name: 'The legal name',
  legal_name_ar: 'The legal name in Arabic',
  address_line: 'The address',
  city: 'The city',
  country: 'The country',
  postal_code: 'The postal code',
  commercial_registration: 'The commercial registration number',
  tax_number: 'The tax number',
  email: 'The e-mail',
  phone: 'The phone number',
  website: 'The website',
  footer_note: 'The footer note',
};

export const EMPTY_SELLER: SellerDetails = {
  legal_name: '',
  legal_name_ar: '',
  address_line: '',
  city: '',
  country: '',
  postal_code: '',
  commercial_registration: '',
  tax_number: '',
  email: '',
  phone: '',
  website: '',
  footer_note: '',
};

export type SellerErrors = Partial<Record<SellerField, string>>;

export function toSellerDetails(raw: unknown): SellerDetails {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out = { ...EMPTY_SELLER };
  for (const key of SELLER_FIELDS) out[key] = typeof r[key] === 'string' ? (r[key] as string) : '';
  return out;
}

export function cleanSellerDetails(s: SellerDetails): SellerDetails {
  const out = { ...EMPTY_SELLER };
  for (const key of SELLER_FIELDS) out[key] = cleanBillingText(s[key]);
  return out;
}

export function validateSellerDetails(seller: SellerDetails): SellerErrors {
  const f = cleanSellerDetails(seller);
  const errors: SellerErrors = {};
  for (const key of SELLER_FIELDS) {
    if (hasControlCharacter(f[key])) errors[key] = `${SELLER_LABELS[key]} contains a character that is not allowed`;
    else if (f[key].length > SELLER_LIMITS[key]) errors[key] = `${SELLER_LABELS[key]} can have at most ${SELLER_LIMITS[key]} characters`;
  }
  if (!errors.legal_name && f.legal_name.length < 2) errors.legal_name = 'Enter the legal name of the company that issues the invoices';
  if (f.email && !errors.email && !EMAIL_RE.test(f.email)) errors.email = 'Enter a valid e-mail address';
  if (f.website && !errors.website && !/^https?:\/\/\S+$/i.test(f.website)) errors.website = 'The website must start with https:// or http://';
  return errors;
}

export function sellerAddressLines(s: SellerDetails): string[] {
  return addressLines(s);
}

export function sellerFacts(s: SellerDetails): LabelValue[] {
  const out: LabelValue[] = [];
  if (s.commercial_registration) out.push({ label: 'Commercial registration', value: s.commercial_registration });
  if (s.tax_number) out.push({ label: 'Tax number', value: s.tax_number });
  if (s.email) out.push({ label: 'E-mail', value: s.email });
  if (s.phone) out.push({ label: 'Phone', value: s.phone });
  if (s.website) out.push({ label: 'Website', value: s.website });
  return out;
}

/* ------------------------------------------------------------------ the invoice document */

export type InvoiceRevision = { revision: number; source: 'issued' | 'reissued'; created_at: string };

export type InvoiceDocument = {
  id: string;
  invoice_number: string;
  kind: string | null;
  status: string;
  currency: string;
  issued_at: string | null;
  due_date: string | null;
  paid_at: string | null;
  payment_method: string | null;
  description: string | null;
  ticket_title: string | null;
  ticket_module: string | null;
  consultant_name: string | null;
  pricing_model: string;
  amount: number;
  vat_amount: number;
  base_amount: number | null;
  service_fee_percent: number | null;
  service_fee_amount: number | null;
  processing_fee_percent: number | null;
  processing_fee_amount: number | null;
  vat_percent: number | null;
  seller: SellerDetails;
  buyer: { type: 'business' | 'personal'; details: BuyerDetails | null; name: string; email: string };
  revision: number;
  revision_at: string | null;
  revisions: InvoiceRevision[];
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Reads the answer of get_invoice_document defensively: a missing value never breaks the page. */
export function toInvoiceDocument(raw: unknown): InvoiceDocument {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const buyerRaw = (r.buyer && typeof r.buyer === 'object' ? r.buyer : {}) as Record<string, unknown>;
  const business = buyerRaw.type === 'business';
  const revisions: InvoiceRevision[] = Array.isArray(r.revisions)
    ? r.revisions.map((x) => {
        const row = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
        return {
          revision: Math.max(0, Math.trunc(num(row.revision))),
          source: row.source === 'reissued' ? ('reissued' as const) : ('issued' as const),
          created_at: str(row.created_at),
        };
      })
    : [];
  return {
    id: str(r.id),
    invoice_number: str(r.invoice_number),
    kind: strOrNull(r.kind),
    status: str(r.status) || 'pending',
    currency: str(r.currency) || 'USD',
    issued_at: strOrNull(r.issued_at),
    due_date: strOrNull(r.due_date),
    paid_at: strOrNull(r.paid_at),
    payment_method: strOrNull(r.payment_method),
    description: strOrNull(r.description),
    ticket_title: strOrNull(r.ticket_title),
    ticket_module: strOrNull(r.ticket_module),
    consultant_name: strOrNull(r.consultant_name),
    pricing_model: str(r.pricing_model) || 'legacy',
    amount: num(r.amount),
    vat_amount: num(r.vat_amount),
    base_amount: numOrNull(r.base_amount),
    service_fee_percent: numOrNull(r.service_fee_percent),
    service_fee_amount: numOrNull(r.service_fee_amount),
    processing_fee_percent: numOrNull(r.processing_fee_percent),
    processing_fee_amount: numOrNull(r.processing_fee_amount),
    vat_percent: numOrNull(r.vat_percent),
    seller: toSellerDetails(r.seller),
    buyer: {
      type: business ? 'business' : 'personal',
      details: business ? toBuyerDetails(buyerRaw) : null,
      name: str(buyerRaw.name),
      email: str(buyerRaw.email),
    },
    revision: Math.max(0, Math.trunc(num(r.revision))),
    revision_at: strOrNull(r.revision_at),
    revisions,
  };
}

export function formatInvoiceMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const pct = (n: number | null): string => `${Number(Number(n ?? 0).toFixed(2))}%`;

export type BreakdownRow = { label: string; amount: number };

/** The lines above the total: the fee parts of a new-style invoice, then the subtotal and the VAT. */
export function breakdownRows(doc: InvoiceDocument): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  const v2 = doc.pricing_model === 'v2' && doc.base_amount !== null;
  if (v2) {
    rows.push({ label: 'Consultant fee (approved hours x hourly rate)', amount: doc.base_amount as number });
    rows.push({ label: `Platform service fee (${pct(doc.service_fee_percent)})`, amount: doc.service_fee_amount ?? 0 });
    rows.push({ label: `Payment processing fee (${pct(doc.processing_fee_percent)})`, amount: doc.processing_fee_amount ?? 0 });
  }
  rows.push({ label: 'Subtotal', amount: round2(doc.amount - doc.vat_amount) });
  rows.push({ label: v2 && doc.vat_percent !== null ? `VAT (${pct(doc.vat_percent)})` : 'VAT', amount: doc.vat_amount });
  return rows;
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Paid',
  paid: 'Paid',
  pending: 'Pending',
  failed: 'Failed',
  refunded: 'Refunded',
  disputed: 'Disputed',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? (status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending');
}

/** The name the browser proposes when the person saves the page as PDF. */
export function invoiceFileTitle(doc: Pick<InvoiceDocument, 'invoice_number' | 'revision'>): string {
  const base = doc.invoice_number || 'invoice';
  return doc.revision >= 1 ? `${base}-rev${doc.revision}` : base;
}

export function revisionLine(r: InvoiceRevision): string {
  return `Revision ${r.revision}: ${r.source === 'issued' ? 'issued with the business details' : 're-issued with the business details'}`;
}
