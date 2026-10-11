import { describe, expect, it } from 'vitest';
import {
  BILLING_LIMITS,
  EMPTY_BILLING_FORM,
  EMPTY_SELLER,
  SELLER_LIMITS,
  billingDetailsComplete,
  billingFormsEqual,
  breakdownRows,
  buyerAddressLines,
  buyerFacts,
  buyerMatchesForm,
  cleanBillingText,
  formatInvoiceMoney,
  hasBillingErrors,
  invoiceFileTitle,
  normaliseBillingForm,
  revisionLine,
  sellerAddressLines,
  sellerFacts,
  statusLabel,
  toBillingForm,
  toBuyerDetails,
  toInvoiceDocument,
  toSellerDetails,
  validateBillingForm,
  validateSellerDetails,
  type BillingForm,
} from './businessInvoice';

const complete: BillingForm = {
  ...EMPTY_BILLING_FORM,
  issue_business_invoices: true,
  business_name: 'QA Business LLC',
  tax_number: '300-123-456',
  address_line: 'Building 5, Tahrir Street',
  city: 'Cairo',
  country: 'Egypt',
  postal_code: '11511',
  billing_email: 'billing@qa-business.example',
  phone: '+20 100 000 0000',
  reference_note: 'PO 4711',
};

const snapshot = {
  business_name: 'QA Business LLC',
  tax_number: '300-123-456',
  commercial_registration: '',
  address_line: 'Building 5, Tahrir Street',
  city: 'Cairo',
  country: 'Egypt',
  postal_code: '11511',
  billing_email: 'billing@qa-business.example',
  phone: '+20 100 000 0000',
  reference_note: 'PO 4711',
};

describe('limits', () => {
  it('are the limits of the database', () => {
    expect(BILLING_LIMITS.business_name).toBe(200);
    expect(BILLING_LIMITS.tax_number).toBe(50);
    expect(BILLING_LIMITS.address_line).toBe(300);
    expect(BILLING_LIMITS.postal_code).toBe(20);
    expect(BILLING_LIMITS.phone).toBe(40);
    expect(BILLING_LIMITS.reference_note).toBe(200);
    expect(SELLER_LIMITS.legal_name).toBe(200);
    expect(SELLER_LIMITS.footer_note).toBe(500);
  });
});

describe('cleanBillingText', () => {
  it('trims and turns every run of white space into one space', () => {
    expect(cleanBillingText('  QA   Business\n LLC ')).toBe('QA Business LLC');
  });

  it('turns nothing into an empty text', () => {
    expect(cleanBillingText(null)).toBe('');
    expect(cleanBillingText(undefined)).toBe('');
  });
});

describe('validateBillingForm', () => {
  it('accepts an empty form while business invoices are off', () => {
    expect(validateBillingForm(EMPTY_BILLING_FORM)).toEqual({});
  });

  it('asks for the name, the address and the country when business invoices are on', () => {
    const errors = validateBillingForm({ ...EMPTY_BILLING_FORM, issue_business_invoices: true });
    expect(Object.keys(errors).sort()).toEqual(['address_line', 'business_name', 'country']);
    expect(hasBillingErrors(errors)).toBe(true);
  });

  it('counts only spaces as nothing', () => {
    const errors = validateBillingForm({ ...complete, business_name: '   ' });
    expect(errors.business_name).toBe('Enter the business name');
  });

  it('accepts a complete form', () => {
    const errors = validateBillingForm(complete);
    expect(errors).toEqual({});
    expect(hasBillingErrors(errors)).toBe(false);
  });

  it('accepts a line break in the address (it is turned into a space)', () => {
    expect(validateBillingForm({ ...complete, address_line: 'Building 5,\n Tahrir Street' })).toEqual({});
  });

  it('checks the e-mail address', () => {
    expect(validateBillingForm({ ...complete, billing_email: 'not-an-email' }).billing_email).toBe('Enter a valid billing e-mail address');
  });

  it('checks the tax number', () => {
    expect(validateBillingForm({ ...complete, tax_number: '12' }).tax_number).toBe('The tax number is too short');
  });

  it('checks the length', () => {
    expect(validateBillingForm({ ...complete, business_name: 'a'.repeat(201) }).business_name).toBe('The business name can have at most 200 characters');
    expect(validateBillingForm({ ...complete, business_name: 'a'.repeat(200) }).business_name).toBeUndefined();
  });

  it('refuses a control character', () => {
    expect(validateBillingForm({ ...complete, business_name: 'QA' + String.fromCharCode(1) + 'Co' }).business_name).toContain('not allowed');
  });

  it('accepts Arabic text', () => {
    expect(validateBillingForm({ ...complete, business_name: 'شركة قرطبة للبرمجيات', address_line: '٥ شارع التحرير', city: 'القاهرة', country: 'مصر' })).toEqual({});
  });
});

describe('billingDetailsComplete', () => {
  it('needs the name, the address and the country', () => {
    expect(billingDetailsComplete(complete)).toBe(true);
    expect(billingDetailsComplete({ ...complete, country: '' })).toBe(false);
    expect(billingDetailsComplete({ ...complete, business_name: 'A' })).toBe(false);
    expect(billingDetailsComplete({ ...complete, address_line: 'ab' })).toBe(false);
  });
});

describe('normaliseBillingForm / toBillingForm / billingFormsEqual', () => {
  it('cleans every text and keeps the switch', () => {
    const f = normaliseBillingForm({ ...complete, business_name: '  QA   Business  LLC ' });
    expect(f.business_name).toBe('QA Business LLC');
    expect(f.issue_business_invoices).toBe(true);
  });

  it('turns no row into the empty form', () => {
    expect(toBillingForm(null)).toEqual(EMPTY_BILLING_FORM);
  });

  it('reads a row and turns missing values into empty texts', () => {
    const f = toBillingForm({ issue_business_invoices: true, business_name: 'X Co', tax_number: null });
    expect(f.issue_business_invoices).toBe(true);
    expect(f.business_name).toBe('X Co');
    expect(f.tax_number).toBe('');
  });

  it('compares two forms after cleaning', () => {
    expect(billingFormsEqual(complete, { ...complete, business_name: ' QA  Business LLC ' })).toBe(true);
    expect(billingFormsEqual(complete, { ...complete, issue_business_invoices: false })).toBe(false);
    expect(billingFormsEqual(complete, { ...complete, city: 'Giza' })).toBe(false);
  });
});

describe('the copy on an invoice', () => {
  it('reads nothing as no details', () => {
    expect(toBuyerDetails(null)).toBeNull();
    expect(toBuyerDetails('text')).toBeNull();
    expect(toBuyerDetails([])).toBeNull();
  });

  it('gives every field a text', () => {
    const b = toBuyerDetails({ business_name: 'X Co' });
    expect(b?.business_name).toBe('X Co');
    expect(b?.tax_number).toBe('');
  });

  it('matches the saved details only when every field is the same', () => {
    const b = toBuyerDetails(snapshot);
    expect(buyerMatchesForm(b, complete)).toBe(true);
    expect(buyerMatchesForm(b, { ...complete, address_line: 'Building 9, Nile Street' })).toBe(false);
    expect(buyerMatchesForm(null, complete)).toBe(false);
  });

  it('lists the address lines without the empty ones', () => {
    const b = toBuyerDetails(snapshot);
    expect(b && buyerAddressLines(b)).toEqual(['Building 5, Tahrir Street', 'Cairo 11511', 'Egypt']);
    const noCity = toBuyerDetails({ ...snapshot, city: '', postal_code: '' });
    expect(noCity && buyerAddressLines(noCity)).toEqual(['Building 5, Tahrir Street', 'Egypt']);
  });

  it('lists the facts that are filled in', () => {
    const b = toBuyerDetails(snapshot);
    expect(b && buyerFacts(b).map((x) => x.label)).toEqual(['Tax number', 'E-mail', 'Phone', 'Your reference']);
  });
});

describe('the seller', () => {
  it('needs a legal name', () => {
    expect(validateSellerDetails({ ...EMPTY_SELLER, legal_name: 'Qurtuba Tech for Software' })).toEqual({});
    expect(validateSellerDetails(EMPTY_SELLER).legal_name).toBe('Enter the legal name of the company that issues the invoices');
  });

  it('checks the e-mail and the website', () => {
    const base = { ...EMPTY_SELLER, legal_name: 'Qurtuba Tech for Software' };
    expect(validateSellerDetails({ ...base, email: 'bad' }).email).toBe('Enter a valid e-mail address');
    expect(validateSellerDetails({ ...base, website: 'ftp://x' }).website).toBe('The website must start with https:// or http://');
    expect(validateSellerDetails({ ...base, website: 'https://www.aisupport360.com' })).toEqual({});
  });

  it('checks the length', () => {
    expect(validateSellerDetails({ ...EMPTY_SELLER, legal_name: 'a'.repeat(201) }).legal_name).toBe('The legal name can have at most 200 characters');
  });

  it('reads only texts', () => {
    expect(toSellerDetails(null)).toEqual(EMPTY_SELLER);
    const s = toSellerDetails({ legal_name: 'A Co', tax_number: 5 });
    expect(s.legal_name).toBe('A Co');
    expect(s.tax_number).toBe('');
  });

  it('lists the lines and the facts that are filled in', () => {
    const s = toSellerDetails({
      legal_name: 'A Co',
      address_line: 'Street 1',
      city: 'New Cairo',
      country: 'Egypt',
      commercial_registration: '226435',
      tax_number: '555',
      email: 'info@x.example',
      website: 'https://x.example',
    });
    expect(sellerAddressLines(s)).toEqual(['Street 1', 'New Cairo', 'Egypt']);
    expect(sellerFacts(s).map((x) => x.label)).toEqual(['Commercial registration', 'Tax number', 'E-mail', 'Website']);
  });
});

describe('toInvoiceDocument', () => {
  const raw = {
    id: 'p1',
    invoice_number: 'INV-2026-Q4-000019',
    kind: 'invoice',
    status: 'pending',
    currency: 'USD',
    issued_at: '2026-10-11T10:00:00+00:00',
    due_date: '2026-10-25',
    paid_at: null,
    payment_method: null,
    description: 'Timesheet 1-7 Oct',
    ticket_title: 'Month-end closing',
    ticket_module: 'FI',
    consultant_name: 'A. Consultant',
    pricing_model: 'v2',
    amount: 396.75,
    vat_amount: 51.75,
    base_amount: 300,
    service_fee_percent: 10,
    service_fee_amount: 30,
    processing_fee_percent: 5,
    processing_fee_amount: 15,
    vat_percent: 15,
    seller: { legal_name: 'Qurtuba Tech for Software', commercial_registration: '226435' },
    buyer: { type: 'business', ...snapshot },
    revision: 2,
    revision_at: '2026-10-12T09:00:00+00:00',
    revisions: [
      { revision: 1, source: 'issued', created_at: '2026-10-11T10:00:00+00:00' },
      { revision: 2, source: 'reissued', created_at: '2026-10-12T09:00:00+00:00' },
    ],
  };

  it('reads a business invoice', () => {
    const doc = toInvoiceDocument(raw);
    expect(doc.invoice_number).toBe('INV-2026-Q4-000019');
    expect(doc.amount).toBe(396.75);
    expect(doc.base_amount).toBe(300);
    expect(doc.paid_at).toBeNull();
    expect(doc.seller.legal_name).toBe('Qurtuba Tech for Software');
    expect(doc.seller.tax_number).toBe('');
    expect(doc.buyer.type).toBe('business');
    expect(doc.buyer.details?.business_name).toBe('QA Business LLC');
    expect(doc.revision).toBe(2);
    expect(doc.revisions.map((r) => r.source)).toEqual(['issued', 'reissued']);
  });

  it('reads a personal invoice', () => {
    const doc = toInvoiceDocument({ ...raw, buyer: { type: 'personal', name: 'Mostafa Saeed', email: 'm@x.example' }, revision: 0, revisions: [] });
    expect(doc.buyer.type).toBe('personal');
    expect(doc.buyer.details).toBeNull();
    expect(doc.buyer.name).toBe('Mostafa Saeed');
    expect(doc.buyer.email).toBe('m@x.example');
    expect(doc.revisions).toEqual([]);
  });

  it('survives missing or wrong values', () => {
    const doc = toInvoiceDocument(null);
    expect(doc.invoice_number).toBe('');
    expect(doc.status).toBe('pending');
    expect(doc.currency).toBe('USD');
    expect(doc.amount).toBe(0);
    expect(doc.pricing_model).toBe('legacy');
    expect(doc.revisions).toEqual([]);
    expect(toInvoiceDocument({ amount: '12.50' }).amount).toBe(12.5);
  });
});

describe('breakdownRows', () => {
  const v2 = toInvoiceDocument({
    amount: 396.75,
    vat_amount: 51.75,
    pricing_model: 'v2',
    base_amount: 300,
    service_fee_percent: 10,
    service_fee_amount: 30,
    processing_fee_percent: 5,
    processing_fee_amount: 15,
    vat_percent: 15,
  });

  it('shows the fee parts, the subtotal and the VAT of a new-style invoice', () => {
    expect(breakdownRows(v2)).toEqual([
      { label: 'Consultant fee (approved hours x hourly rate)', amount: 300 },
      { label: 'Platform service fee (10%)', amount: 30 },
      { label: 'Payment processing fee (5%)', amount: 15 },
      { label: 'Subtotal', amount: 345 },
      { label: 'VAT (15%)', amount: 51.75 },
    ]);
  });

  it('shows only the subtotal and the VAT of an old-style invoice', () => {
    const legacy = toInvoiceDocument({ amount: 114, vat_amount: 14, pricing_model: 'legacy' });
    expect(breakdownRows(legacy)).toEqual([
      { label: 'Subtotal', amount: 100 },
      { label: 'VAT', amount: 14 },
    ]);
  });

  it('treats a new-style invoice without a fee as an old-style one', () => {
    const odd = toInvoiceDocument({ amount: 114, vat_amount: 14, pricing_model: 'v2', base_amount: null });
    expect(breakdownRows(odd).map((r) => r.label)).toEqual(['Subtotal', 'VAT']);
  });

  it('rounds the subtotal to cents', () => {
    const doc = toInvoiceDocument({ amount: 10.3, vat_amount: 0.1 });
    expect(breakdownRows(doc)[0].amount).toBe(10.2);
  });
});

describe('small helpers', () => {
  it('names the status', () => {
    expect(statusLabel('completed')).toBe('Paid');
    expect(statusLabel('pending')).toBe('Pending');
    expect(statusLabel('refunded')).toBe('Refunded');
    expect(statusLabel('on_hold')).toBe('On_hold');
    expect(statusLabel('')).toBe('Pending');
  });

  it('proposes a file name that carries the revision', () => {
    expect(invoiceFileTitle({ invoice_number: 'INV-2026-Q4-000019', revision: 0 })).toBe('INV-2026-Q4-000019');
    expect(invoiceFileTitle({ invoice_number: 'INV-2026-Q4-000019', revision: 2 })).toBe('INV-2026-Q4-000019-rev2');
    expect(invoiceFileTitle({ invoice_number: '', revision: 0 })).toBe('invoice');
  });

  it('describes a revision', () => {
    expect(revisionLine({ revision: 1, source: 'issued', created_at: '' })).toBe('Revision 1: issued with the business details');
    expect(revisionLine({ revision: 2, source: 'reissued', created_at: '' })).toBe('Revision 2: re-issued with the business details');
  });

  it('formats money', () => {
    expect(formatInvoiceMoney(396.75, 'USD')).toBe('$396.75');
    expect(formatInvoiceMoney(0, '')).toBe('$0.00');
    expect(formatInvoiceMoney(12.5, 'XX')).toBe('12.50 XX');
  });
});
