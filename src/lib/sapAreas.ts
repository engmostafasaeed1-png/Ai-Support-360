// The master list of SAP modules and areas a client can choose from when opening or editing a ticket.
// A ticket stores the NAMES below (tickets.sap_modules, in the order chosen; tickets.sap_module is the main area = the first one).
// Never rename an entry that tickets may already use. Add new entries instead.

export interface SapArea {
  name: string;
  hint: string;
}

export interface SapAreaGroup {
  id: string;
  label: string;
  areas: SapArea[];
}

/** The entry for "my area is not in the list". The client names it in tickets.sap_module_other. */
export const OTHER_AREA = 'Other';
/** Same limits as the database trigger tickets_normalize_areas(). */
export const MAX_SAP_AREAS = 12;
export const MAX_AREA_NAME_LENGTH = 80;
export const MAX_OTHER_AREA_LENGTH = 160;
export const MAX_AREA_DETAILS_LENGTH = 2000;
/** The AI functions accept at most 100 characters in sap_module. */
export const MAX_AREA_SUMMARY_LENGTH = 100;

const a = (name: string, hint: string): SapArea => ({ name, hint });

export const SAP_AREA_GROUPS: SapAreaGroup[] = [
  {
    id: 'erp',
    label: 'ERP core and migration',
    areas: [
      a('SAP S/4HANA', 'Core ERP on HANA: implementation, upgrade and support'),
      a('SAP S/4HANA Cloud Public Edition', 'Standard cloud ERP, fit-to-standard, key user extensibility'),
      a('SAP S/4HANA Cloud Private Edition', 'RISE with SAP, private cloud ERP'),
      a('SAP ECC 6.0', 'Classic ERP: support, enhancement packages, maintenance'),
      a('S/4HANA Migration and Conversion', 'Greenfield, brownfield, selective data transition, SUM and DMO'),
      a('Data Migration', 'Migration cockpit, LSMW, legacy data load and cleansing'),
      a('SAP Business One', 'ERP for small and mid-size companies'),
      a('SAP Business ByDesign', 'Cloud ERP for mid-size companies'),
      a('SAP Master Data Governance (MDG)', 'Central master data for material, business partner and finance'),
      a('Business Partner and Master Data', 'Customer and vendor master data, CVI, data quality'),
      a('SAP Landscape Transformation (SLT)', 'Data replication, system consolidation and carve-out'),
      a('SAP Solution Manager', 'ChaRM, monitoring, Focused Build and test management'),
      a('SAP Cloud ALM', 'Implementation and operations management for cloud'),
      a('SAP Activate Methodology', 'Project phases, fit-to-standard workshops, deliverables'),
      a('Rollout and Template Design', 'Global template, local rollouts, localization'),
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    areas: [
      a('SAP FI/CO', 'Financial accounting and controlling in general'),
      a('FI - General Ledger (FI-GL)', 'Postings, periods, closing, chart of accounts, universal journal'),
      a('FI - Accounts Payable (FI-AP)', 'Vendor invoices, payments, payment runs'),
      a('FI - Accounts Receivable (FI-AR)', 'Customer invoices, incoming payments, dunning'),
      a('FI - Asset Accounting (FI-AA)', 'Fixed assets, depreciation, assets under construction'),
      a('FI - Bank Accounting and Cash Management', 'House banks, bank statements, cash position, liquidity'),
      a('FI - Taxes and Localization', 'VAT, withholding tax, e-invoicing, country versions'),
      a('CO - Cost Center Accounting', 'Cost centers, allocations, planning'),
      a('CO - Internal Orders', 'Order settlement, overhead orders, investment orders'),
      a('CO - Product Costing', 'Standard cost, cost estimates, WIP, variances'),
      a('CO - Profitability Analysis (CO-PA)', 'Margin analysis, account-based and costing-based'),
      a('CO - Profit Center and Segment Reporting', 'Profit centers, segments, management reporting'),
      a('Material Ledger and Actual Costing', 'Price determination, actual costing, valuation'),
      a('Financial Closing and Consolidation', 'Period-end close, group reporting, intercompany'),
      a('SAP Central Finance', 'Central finance with source systems and replication'),
      a('Treasury and Risk Management', 'Treasury, hedging, in-house cash, bank communication'),
      a('Credit and Collections Management', 'Credit limits, dispute management, collections'),
      a('Revenue Accounting and Reporting (RAR)', 'IFRS 15 revenue recognition'),
      a('Billing and Revenue Innovation Management (BRIM)', 'Subscription and convergent billing, contract accounts'),
      a('Lease Accounting (IFRS 16)', 'Leases, right-of-use assets'),
      a('Real Estate Management (RE-FX)', 'Contracts, rental, real estate objects'),
      a('Public Sector and Funds Management', 'Funds, grants, commitment control'),
      a('Document and Reporting Compliance', 'Statutory reports, e-documents, tax compliance'),
    ],
  },
  {
    id: 'logistics',
    label: 'Logistics and supply chain',
    areas: [
      a('SAP MM', 'Materials management in general'),
      a('MM - Purchasing and Procurement', 'Requisitions, purchase orders, contracts, release strategies'),
      a('MM - Inventory Management', 'Goods movements, stock, physical inventory, valuation'),
      a('MM - Invoice Verification and GR/IR', 'Logistics invoice verification, GR/IR clearing'),
      a('Subcontracting and Consignment', 'Subcontracting, consignment, pipeline stock'),
      a('Intercompany and Stock Transport', 'Stock transport orders, intercompany billing, cross-company processes'),
      a('SAP SD', 'Sales and distribution in general'),
      a('SD - Sales Order Management', 'Quotes, orders, returns, scheduling agreements'),
      a('SD - Pricing and Conditions', 'Condition technique, pricing procedures, rebates'),
      a('SD - Shipping and Delivery', 'Deliveries, picking, packing, goods issue'),
      a('SD - Billing', 'Billing documents, invoices, credit memos, accounting interface'),
      a('SD - Output and Document Management', 'Output determination, forms, EDI output'),
      a('Advanced Available-to-Promise (aATP)', 'Availability check, allocation, product availability'),
      a('Variant Configuration (LO-VC)', 'Configurable products, classes, dependencies'),
      a('SAP PP', 'Production planning in general'),
      a('PP - MRP and Demand-Driven MRP', 'Material requirements planning, planning runs'),
      a('PP - Production Orders and Shop Floor', 'Order processing, confirmations, backflush'),
      a('PP - Process Manufacturing (PP-PI)', 'Process orders, recipes, batches'),
      a('PP/DS - Detailed Scheduling', 'Production planning and detailed scheduling'),
      a('Manufacturing Execution and Digital Manufacturing', 'ME, MII, Digital Manufacturing'),
      a('SAP QM', 'Quality management'),
      a('SAP PM/EAM', 'Plant maintenance and enterprise asset management'),
      a('SAP PS', 'Project system'),
      a('SAP EWM', 'Extended warehouse management'),
      a('SAP WM', 'Warehouse management (classic)'),
      a('SAP TM', 'Transportation management'),
      a('Global Trade Services (GTS)', 'Customs, compliance, preference management'),
      a('Integrated Business Planning (IBP)', 'Demand, supply, inventory and S&OP planning'),
      a('Environment, Health and Safety (EHS)', 'Product compliance, dangerous goods, incident management'),
      a('Batch Management and Serialization', 'Batches, serial numbers, track and trace'),
      a('Customer Service and Field Service', 'Service orders, contracts, field service management'),
      a('Supply Network Collaboration', 'Supplier collaboration, forecasts, advance shipping notices'),
      a('Logistics Execution and Yard Logistics', 'Inbound, outbound, yard management'),
    ],
  },
  {
    id: 'procurement',
    label: 'Procurement and spend management',
    areas: [
      a('SAP Ariba', 'Ariba solutions in general'),
      a('Ariba Sourcing and Contracts', 'Sourcing events, RFx, contract management'),
      a('Ariba Buying and Invoicing', 'Guided buying, catalogs, invoice automation'),
      a('Ariba Supplier Management', 'Supplier lifecycle, risk and performance'),
      a('Ariba Network and Collaboration', 'Network integration, cXML, purchase orders and invoices'),
      a('SAP Fieldglass', 'External workforce and services procurement'),
      a('SAP Concur', 'Travel and expense management'),
      a('SAP Business Network', 'Trading partner collaboration'),
      a('S/4HANA Sourcing and Procurement', 'Central procurement, operational procurement'),
    ],
  },
  {
    id: 'hcm',
    label: 'Human capital management',
    areas: [
      a('SuccessFactors', 'SuccessFactors in general'),
      a('SuccessFactors Employee Central', 'Core HR, position management, workflows'),
      a('SuccessFactors Employee Central Payroll', 'Cloud payroll'),
      a('SuccessFactors Recruiting and Onboarding', 'Job requisitions, candidates, onboarding'),
      a('SuccessFactors Performance and Goals', 'Reviews, goals, calibration'),
      a('SuccessFactors Learning', 'Learning management, catalogs, assignments'),
      a('SuccessFactors Compensation and Succession', 'Compensation planning, succession, talent pools'),
      a('SuccessFactors Time Tracking and Time Off', 'Time sheets, leave, absence'),
      a('SAP HCM (on-premise)', 'HR in ERP: personnel administration, organization, time, payroll'),
      a('SAP HCM Payroll', 'Payroll schemas, wage types, country payroll'),
      a('SAP HCM Time Management', 'Work schedules, time evaluation, attendance'),
      a('Organizational Management and Personnel Administration', 'Org structures, positions, infotypes'),
      a('HCM for S/4HANA (H4S4)', 'HCM running on S/4HANA'),
      a('Employee and Manager Self-Service (ESS/MSS)', 'Self-service portals, Fiori HR apps'),
      a('SAP Employee Experience (Qualtrics)', 'Employee experience surveys'),
    ],
  },
  {
    id: 'cx',
    label: 'Customer experience and commerce',
    areas: [
      a('SAP Customer Experience (CX)', 'CX suite in general'),
      a('SAP Sales Cloud', 'Leads, opportunities, quotes'),
      a('SAP Service Cloud', 'Service tickets, knowledge, service contracts'),
      a('SAP Commerce Cloud', 'B2B and B2C commerce, storefronts, catalogs'),
      a('SAP Marketing Cloud and Emarsys', 'Campaigns, segmentation, customer engagement'),
      a('SAP Customer Data Cloud and CDP', 'Identity, consent, customer data platform'),
      a('SAP CRM (on-premise)', 'Classic CRM: sales, service, marketing'),
      a('SAP Subscription Billing', 'Subscriptions, usage-based billing'),
      a('SAP Customer Checkout and Retail POS', 'Point of sale'),
    ],
  },
  {
    id: 'technology',
    label: 'Technology and platform',
    areas: [
      a('SAP BTP/CPI', 'Business Technology Platform and cloud integration'),
      a('SAP Fiori/UX', 'Fiori apps, launchpad, UX design'),
      a('SAP Basis', 'System administration in general'),
      a('SAP Security/GRC', 'Security and governance, risk and compliance in general'),
      a('ABAP Development', 'Custom programs, enhancements, reports, forms'),
      a('Integrations/APIs', 'Interfaces, APIs, middleware in general'),
      a('Integration Suite and Cloud Integration', 'Integration flows, adapters, API management'),
      a('Process Orchestration (PI/PO)', 'Classic middleware, ESR, integration directory, BPM'),
      a('API Management and Event Mesh', 'API proxies, events, messaging'),
      a('SAP Build (Apps, Process Automation, Work Zone)', 'Low-code, RPA, workflows'),
      a('BTP Development (CAP, Node.js, Java)', 'Cloud Application Programming model, Business Application Studio'),
      a('ABAP Cloud and RAP', 'RESTful ABAP programming, clean core extensions'),
      a('SAPUI5 and Fiori Elements', 'Custom UI5 apps, Fiori elements, annotations'),
      a('Fiori Launchpad and Work Zone', 'Launchpad configuration, spaces, pages, roles'),
      a('Gateway and OData Services', 'OData, CDS views, service activation'),
      a('SAP HANA Database', 'HANA administration, modeling, performance'),
      a('SAP HANA Cloud', 'HANA Cloud, data lake'),
      a('IDoc and EDI', 'IDoc processing, partner profiles, EDI'),
      a('Forms and Output Management', 'Adobe Forms, SAPscript, Smart Forms, BRF+'),
      a('Workflow and Business Rules', 'SAP Business Workflow, flexible workflow, rules'),
      a('Basis - Installation, Upgrade and System Copy', 'Installation, upgrade, patching, refresh'),
      a('Basis - Performance and Tuning', 'Workload analysis, memory, database tuning'),
      a('Basis - Transport Management (CTS+)', 'Transports, landscape, transport routes'),
      a('Basis - Backup, Monitoring and Jobs', 'Backup, monitoring, batch jobs and scheduling'),
      a('Cloud Connector and Connectivity', 'Cloud Connector, destinations, networking'),
      a('Identity Management and Single Sign-On', 'Identity services, SSO, SNC, SAML'),
      a('GRC Access Control', 'Segregation of duties, firefighter, access requests'),
      a('GRC Process Control and Risk Management', 'Controls, risks, compliance'),
      a('Authorizations and Roles (PFCG)', 'Role design, SU24, authorization errors'),
      a('Security Audit and Hardening', 'Security audit, hardening, vulnerabilities, patches'),
      a('Enterprise Threat Detection', 'Security monitoring, log analysis'),
      a('Data Intelligence and AI Core', 'Machine learning pipelines, AI services'),
      a('SAP Business AI and Joule', 'Generative AI scenarios, Joule copilot'),
      a('Mobile Services and Mobile Apps', 'Mobile development kit, mobile start'),
      a('Monitoring and Support Tools', 'Focused Run, EarlyWatch Alert, monitoring'),
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics and reporting',
    areas: [
      a('SAP Analytics Cloud', 'Stories, planning, predictive'),
      a('SAP BW/4HANA', 'Data warehouse on HANA'),
      a('SAP BW (classic and BW on HANA)', 'InfoProviders, process chains, queries'),
      a('SAP Datasphere', 'Business data fabric, spaces, data flows'),
      a('SAP BusinessObjects BI', 'Web Intelligence, Crystal Reports, Analysis for Office'),
      a('Embedded Analytics and CDS Views', 'Query browser, CDS analytics, KPI apps'),
      a('Data Services and ETL', 'Data Services, data quality, data integration'),
      a('Signavio and Process Mining', 'Process modeling and process mining'),
      a('LeanIX and Enterprise Architecture', 'Landscape and architecture management'),
      a('Custom Reports and ALV', 'Custom reports, ALV grids, queries'),
    ],
  },
  {
    id: 'industry',
    label: 'Industry solutions',
    areas: [
      a('SAP for Retail', 'IS-Retail, CAR, merchandising'),
      a('SAP for Utilities (IS-U)', 'Billing, contract accounting, device management'),
      a('SAP for Oil and Gas', 'Upstream, downstream, joint venture accounting'),
      a('SAP for Healthcare', 'IS-H, patient management'),
      a('SAP for Banking and Insurance', 'Banking, insurance, contract accounting'),
      a('SAP for Public Sector', 'Government, grants, budget'),
      a('SAP for Automotive', 'Automotive suppliers and manufacturers'),
      a('SAP for Pharma and Life Sciences', 'GxP, batch traceability, serialization'),
      a('SAP for Chemicals', 'Chemicals, batch and recipe management'),
      a('SAP for Mining and Mill Products', 'Mining, metals, mill products'),
      a('SAP for Aerospace and Defense', 'Project and contract manufacturing'),
      a('SAP for Professional Services', 'Project billing, resource management'),
      a('SAP for Media and Telecommunications', 'Rights, royalties, telecom billing'),
      a('SAP for Higher Education and Research', 'Student lifecycle, grants'),
      a('SAP for Consumer Products and Fashion', 'Fashion, apparel, consumer goods'),
      a('SAP for Agriculture and Food', 'Agribusiness, food safety'),
    ],
  },
  {
    id: 'services',
    label: 'Services and support',
    areas: [
      a('AMS Support', 'Application management and ongoing support'),
      a('Health Check/Advisory', 'System health check, advisory, roadmap'),
      a('Go-Live and Hypercare Support', 'Cutover, go-live, post go-live support'),
      a('Testing and Test Automation', 'Test planning, user acceptance tests, automation'),
      a('Training and Knowledge Transfer', 'End-user training, documentation'),
      a('Project and Program Management', 'Planning, governance, project office'),
      a('Business Process Design and Fit-to-Standard', 'Process workshops, blueprint'),
      a('Licensing and Contract Advice', 'SAP licensing, contract review'),
      a('Audit and Compliance Support', 'Audit preparation, controls evidence'),
      a('Carve-out and M and A Integration', 'Divestiture, merger integration'),
      a('Custom Code Review and Clean Core', 'ABAP test cockpit, code remediation, clean core'),
      a('Upgrade and Patch Planning', 'Enhancement packages, support packages, upgrade planning'),
    ],
  },
];

export const ALL_SAP_AREAS: SapArea[] = SAP_AREA_GROUPS.flatMap(g => g.areas);

export function isOtherArea(name: string): boolean {
  return name.trim().toLowerCase() === OTHER_AREA.toLowerCase();
}

function tidy(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** The usual short names that people (and the AI chat) use for an area of the list. */
const AREA_ALIASES: Record<string, string> = {
  mm: 'SAP MM', sd: 'SAP SD', pp: 'SAP PP', qm: 'SAP QM', pm: 'SAP PM/EAM', ps: 'SAP PS', ewm: 'SAP EWM', wm: 'SAP WM', tm: 'SAP TM',
  fi: 'SAP FI/CO', co: 'SAP FI/CO', fico: 'SAP FI/CO', 'fi/co': 'SAP FI/CO',
  basis: 'SAP Basis', abap: 'ABAP Development', btp: 'SAP BTP/CPI', cpi: 'SAP BTP/CPI', fiori: 'SAP Fiori/UX',
  hcm: 'SAP HCM (on-premise)', hr: 'SAP HCM (on-premise)', successfactors: 'SuccessFactors',
  's/4hana': 'SAP S/4HANA', s4hana: 'SAP S/4HANA', 's4 hana': 'SAP S/4HANA',
  grc: 'SAP Security/GRC', ariba: 'SAP Ariba', crm: 'SAP CRM (on-premise)',
  bw: 'SAP BW (classic and BW on HANA)', 'bw/4hana': 'SAP BW/4HANA',
};

/**
 * The area of the master list that a free text means ("MM", "SAP MM", "sap fi/co"), or null when there is none.
 * The AI chat and old links name a module in their own way; the request form needs the names of the list.
 */
export function resolveArea(text: string): string | null {
  const clean = tidy(text);
  if (!clean) return null;
  const lower = clean.toLowerCase();
  const exact = ALL_SAP_AREAS.find(x => x.name.toLowerCase() === lower);
  if (exact) return exact.name;
  const withoutPrefix = lower.replace(/^sap\s+/, '').replace(/\s+module$/, '');
  const alias = AREA_ALIASES[withoutPrefix];
  if (alias) return alias;
  const prefixed = ALL_SAP_AREAS.find(x => x.name.toLowerCase() === `sap ${withoutPrefix}`);
  return prefixed ? prefixed.name : null;
}

/** Same cleaning as the database: trimmed, no blanks, no duplicates (any capitals), order kept. */
export function cleanAreaList(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const name = tidy(raw);
    if (!name) continue;
    if (out.some(x => x.toLowerCase() === name.toLowerCase())) continue;
    out.push(name);
  }
  return out;
}

export function hasArea(list: readonly string[], name: string): boolean {
  return list.some(x => x.toLowerCase() === tidy(name).toLowerCase());
}

/** Adds the area at the end, or removes it when it is already chosen. Refuses a 13th area. */
export function toggleArea(list: readonly string[], name: string, max: number = MAX_SAP_AREAS): string[] {
  const clean = tidy(name);
  if (!clean) return [...list];
  if (hasArea(list, clean)) return list.filter(x => x.toLowerCase() !== clean.toLowerCase());
  if (list.length >= max) return [...list];
  return [...list, clean];
}

/** The first area is the main area: moves the given one to the front. */
export function makeMainArea(list: readonly string[], name: string): string[] {
  const i = list.findIndex(x => x.toLowerCase() === tidy(name).toLowerCase());
  if (i <= 0) return [...list];
  return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

/** "Other" with the name the client typed becomes "Other: <name>". */
export function areaLabel(name: string, other?: string | null): string {
  const text = (other ?? '').trim();
  return isOtherArea(name) && text ? `${OTHER_AREA}: ${text}` : name;
}

/**
 * One short line for places that take a single module string (the AI functions accept 100 characters at most).
 * Example: "SAP FI/CO, SAP MM +2 more".
 */
export function areasSummary(list: readonly string[], other?: string | null, max: number = MAX_AREA_SUMMARY_LENGTH): string {
  const names = cleanAreaList(list).map(n => areaLabel(n, other));
  if (names.length === 0) return '';
  let out = '';
  let used = 0;
  for (let i = 0; i < names.length; i++) {
    const candidate = out ? `${out}, ${names[i]}` : names[i];
    const left = names.length - (i + 1);
    const suffix = left > 0 ? ` +${left} more` : '';
    if ((candidate + suffix).length <= max) {
      out = candidate;
      used = i + 1;
    } else {
      break;
    }
  }
  if (used === 0) return names[0].slice(0, max);
  const rest = names.length - used;
  return rest > 0 ? `${out} +${rest} more` : out;
}

/** The areas of a ticket: the list when it has one, otherwise the single main module of older tickets. */
export function areasOf(ticket: { sap_module?: string | null; sap_modules?: readonly string[] | null }): string[] {
  const list = cleanAreaList(ticket.sap_modules ?? []);
  if (list.length > 0) return list;
  const single = tidy(ticket.sap_module ?? '');
  return single ? [single] : [];
}

/** Keeps the groups and areas that contain every word of the search (in the name or in what the area covers). */
export function filterAreaGroups(groups: readonly SapAreaGroup[], query: string): SapAreaGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...groups];
  const out: SapAreaGroup[] = [];
  for (const g of groups) {
    const areas = g.areas.filter(area => {
      const hay = `${area.name} ${area.hint}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
    if (areas.length > 0) out.push({ ...g, areas });
  }
  return out;
}
