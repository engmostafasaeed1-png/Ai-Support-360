/**
 * Ready lists for the consultant profile and the client request (the same lists feed the AI matching).
 * A value is stored as its English label (text[] columns). "Other" lets the consultant type a free text that is stored as the typed text.
 * Groups are only for display (collapsible sections in the multi-select).
 */
export type TaxonomyGroup = { group: string; items: string[] };

/** 1. Industries the consultant has worked in (SAP's 25 industries plus the regional ones used in the Middle East, Africa and Asia). */
export const INDUSTRY_EXPERIENCE: TaxonomyGroup[] = [
  { group: 'Energy & resources', items: ['Oil & gas - upstream', 'Oil & gas - downstream / refining', 'Oil & gas - midstream / pipelines', 'Oil & gas - oilfield services & drilling', 'Petrochemicals', 'Fertilizers & agrochemicals', 'Chemicals', 'Utilities - electricity', 'Utilities - water & wastewater', 'Waste management & recycling', 'Renewable energy', 'Nuclear & power generation', 'Mining', 'Metals & steel', 'Mill products (paper, wood, cement, glass)'] },
  { group: 'Manufacturing & industry', items: ['Discrete manufacturing', 'Process manufacturing', 'Industrial machinery & components', 'Automotive', 'Aerospace & defense', 'High tech & electronics', 'Building materials & construction products', 'Textiles, apparel & furniture', 'Packaging & printing'] },
  { group: 'Consumer & retail', items: ['Retail - grocery & convenience', 'Retail - fashion & specialty', 'Wholesale distribution', 'Consumer products (FMCG)', 'Food & beverage', 'Agribusiness & agriculture', 'Hospitality, hotels & tourism', 'Sports & entertainment', 'Media & publishing'] },
  { group: 'Financial services', items: ['Banking - retail', 'Banking - corporate & Islamic', 'Insurance - life & health', 'Insurance - property & casualty', 'Asset management & investment', 'Capital markets', 'Payments & fintech', 'Leasing & financing'] },
  { group: 'Public & social', items: ['Government - ministries & authorities', 'Municipalities & local government', 'Defense & security', 'Education - schools', 'Higher education & research', 'Healthcare - hospitals & providers', 'Healthcare - payers & health insurance', 'Life sciences & pharmaceuticals', 'Medical devices', 'Non-profit & NGOs', 'Religious & endowment (Awqaf) entities'] },
  { group: 'Services & infrastructure', items: ['Telecommunications', 'IT services & software', 'Professional services & consulting', 'Engineering, construction & operations (EC&O)', 'Real estate & property development', 'Facility management', 'Logistics & freight', 'Transportation - airlines & airports', 'Transportation - ports, rail & shipping', 'Postal & courier'] },
  { group: 'Other', items: ['Other'] },
];

/** 2. Customer segments (who the consultant has delivered for). */
export const CUSTOMER_SEGMENTS: TaxonomyGroup[] = [
  { group: 'Public sector', items: ['Government ministries & authorities', 'Semi-government / government-related entities', 'Municipalities & local government', 'Sovereign-wealth-fund-owned companies (PIF, Mubadala, ADQ, QIA, KIA and similar)', 'Giga-projects & national mega programs', 'State-owned enterprises (SOEs)', 'Defense & security entities', 'Public universities & hospitals'] },
  { group: 'Private sector', items: ['Large listed enterprise', 'Multinational subsidiary', 'Family-owned business / conglomerate', 'Mid-market company', 'Small business (SME)', 'Start-up / scale-up', 'Private equity portfolio company'] },
  { group: 'Not-for-profit', items: ['Non-profit / NGO', 'International organization (UN, development banks)', 'Foundations & endowments'] },
  { group: 'Other', items: ['Other'] },
];

/** 3. Vertical (industry) solutions and industry-specific SAP products. */
export const VERTICAL_SOLUTIONS: TaxonomyGroup[] = [
  { group: 'Oil, gas & utilities', items: ['SAP Oil & Gas (upstream: JVA, production accounting, hydrocarbon product management)', 'SAP Oil & Gas (downstream: refining, tank terminals, TSW, retail fuel stations)', 'SAP IS-Utilities (IS-U, billing and customer service)', 'SAP S/4HANA for utilities (contract accounts, FI-CA)', 'SAP Meter data & smart metering', 'SAP Asset management for utilities (PM, EAM, linear assets)'] },
  { group: 'Retail & consumer', items: ['SAP Retail (merchandising, assortment, replenishment)', 'SAP CAR (Customer Activity Repository) & omnichannel', 'SAP Commerce / Customer Experience', 'SAP Fashion Management', 'SAP Consumer Products (trade promotion management, DSD)', 'SAP Agricultural Contract Management'] },
  { group: 'Financial services', items: ['SAP Bank Analyzer / Financial Products Subledger', 'SAP S/4HANA for Banking (loans, deposits, collateral)', 'SAP FS-CD (Collections & Disbursements) and FS-ICM (insurance)', 'SAP Insurance (FS-PM, FS-RI, FS-CMS)', 'SAP Treasury & Risk Management', 'SAP Credit Management & Collections (FSCM)', 'SAP In-House Cash & Bank communication management'] },
  { group: 'Healthcare & life sciences', items: ['SAP IS-Healthcare (IS-H, patient management)', 'SAP Patient billing & hospital finance', 'SAP Life sciences (batch traceability, serialization, track & trace)', 'SAP Quality management for pharma (QM, GMP)', 'SAP Medical device UDI compliance', 'SAP Pharma distribution & wholesale'] },
  { group: 'Public sector & education', items: ['SAP Public Sector Management (PSM-FM, funds management, grants)', 'SAP Grants Management', 'SAP Public Budget Formulation', 'SAP Government tax & revenue management', 'SAP Student Lifecycle Management (SLCM) / Higher Education & Research', 'SAP Defense & Security (DFPS)', 'SAP Real Estate Flexible (RE-FX) / property management'] },
  { group: 'Manufacturing & industry', items: ['SAP Automotive (VMS, JIT/JIS, supplier network)', 'SAP Aerospace & Defense (project manufacturing, MRO)', 'SAP Mill Products (paper, steel, rolling)', 'SAP Mining (mine-to-market, heavy equipment)', 'SAP Chemicals (PRA, recipe management, EHS)', 'SAP Engineering, construction & operations (project systems, EPPM)', 'SAP Discrete industries (variant configuration, engineer-to-order)', 'SAP Digital Manufacturing (DM / ME / MII)', 'SAP Product Lifecycle Management (PLM, EHS)', 'SAP Food & beverage (batch management, traceability, shelf life)', 'SAP Cement, aggregates & construction materials', 'SAP Waste management & recycling', 'SAP Nuclear & power generation (fuel, outage planning)'] },
  { group: 'Services, telecom & transport', items: ['SAP Telecommunications (convergent charging, billing, BRIM)', 'SAP Media (rights, royalties, advertising sales)', 'SAP Professional services (project billing, PS, resource management)', 'SAP Transportation Management (TM)', 'SAP Extended Warehouse Management (EWM)', 'SAP Global Trade Services (GTS) & customs', 'SAP Airlines, airports & aviation', 'SAP Ports, shipping & rail', 'SAP Hospitality & travel'] },
  { group: 'Other', items: ['Other'] },
];

/** 4. Country localization: countries in which the consultant configured local statutory requirements. */
export const LOCALIZATION_COUNTRIES: TaxonomyGroup[] = [
  { group: 'GCC', items: ['Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Bahrain', 'Oman'] },
  { group: 'Middle East & North Africa', items: ['Egypt', 'Jordan', 'Lebanon', 'Iraq', 'Syria', 'Yemen', 'Palestine', 'Morocco', 'Algeria', 'Tunisia', 'Libya', 'Sudan', 'Turkey', 'Israel', 'Iran'] },
  { group: 'Africa', items: ['South Africa', 'Nigeria', 'Kenya', 'Ghana', 'Ethiopia', 'Tanzania', 'Uganda', 'Senegal', 'Ivory Coast', 'Cameroon', 'Angola', 'Mozambique', 'Zambia', 'Zimbabwe', 'Botswana', 'Namibia', 'Rwanda', 'Democratic Republic of the Congo', 'Mauritius', 'Madagascar', 'Mali', 'Burkina Faso', 'Gabon'] },
  { group: 'Europe', items: ['Germany', 'United Kingdom', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Switzerland', 'Austria', 'Poland', 'Romania', 'Greece', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Portugal', 'Ireland', 'Czech Republic', 'Hungary', 'Russia', 'Ukraine', 'Bulgaria', 'Croatia', 'Serbia', 'Slovakia', 'Slovenia', 'Lithuania', 'Latvia', 'Estonia', 'Luxembourg', 'Iceland', 'Cyprus', 'Malta', 'Belarus', 'Bosnia and Herzegovina', 'Albania', 'North Macedonia', 'Montenegro', 'Moldova'] },
  { group: 'Asia & Pacific', items: ['India', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal', 'China', 'Hong Kong', 'Taiwan', 'Japan', 'South Korea', 'Singapore', 'Malaysia', 'Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'Cambodia', 'Myanmar', 'Mongolia', 'Kazakhstan', 'Uzbekistan', 'Azerbaijan', 'Georgia', 'Armenia', 'Afghanistan', 'Australia', 'New Zealand', 'Papua New Guinea', 'Fiji'] },
  { group: 'Americas', items: ['United States', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'Chile', 'Colombia', 'Peru', 'Ecuador', 'Uruguay', 'Paraguay', 'Bolivia', 'Venezuela', 'Costa Rica', 'Panama', 'Guatemala', 'Dominican Republic', 'Jamaica', 'Trinidad and Tobago', 'Puerto Rico'] },
  { group: 'Other', items: ['Other'] },
];

/** 5. Localization solutions: the local statutory topics the consultant implemented (what the country law requires). */
export const LOCALIZATION_SOLUTIONS: TaxonomyGroup[] = [
  { group: 'E-invoicing & tax compliance', items: ['Saudi Arabia ZATCA e-invoicing (FATOORA, phase 1 and 2)', 'UAE e-invoicing / Federal Tax Authority (Peppol)', 'Egypt e-invoice & e-receipt (ETA)', 'Oman, Bahrain, Qatar & Kuwait VAT and e-invoicing', 'Turkey e-Fatura / e-Arsiv / e-Defter', 'India GST e-invoicing & e-way bill', 'Brazil NF-e / SPED', 'Mexico CFDI', 'Italy SDI / e-invoicing', 'Spain SII / TicketBAI', 'France e-invoicing (Chorus Pro, PDP)', 'Poland KSeF', 'Germany / EU e-invoicing (XRechnung, ZUGFeRD)', 'Peppol network', 'SAP Document and Reporting Compliance (DRC)', 'Advance VAT returns & VAT reporting', 'Withholding tax (WHT) & extended withholding tax', 'Zakat & income tax reporting', 'Transfer pricing & country-by-country reporting', 'SAF-T / audit file reporting', 'Excise tax & customs duties'] },
  { group: 'Payroll & HR localization', items: ['Saudi payroll (GOSI, Mudad, WPS, Nitaqat/Saudization)', 'UAE payroll (WPS, gratuity)', 'Egypt payroll (social insurance, tax)', 'Gulf end-of-service benefits (EOSB)', 'Kuwait, Qatar, Oman & Bahrain payroll', 'India payroll (PF, ESI, TDS)', 'Germany / EU payroll', 'UK payroll (RTI, pensions)', 'US payroll (tax, benefits)', 'SuccessFactors Employee Central payroll localization', 'Time & attendance with local labor law', 'Expatriate & global mobility'] },
  { group: 'Banking, payments & treasury', items: ['SARIE & Saudi bank formats', 'UAE bank formats & WPS', 'SEPA & ISO 20022 payment formats', 'Bank statement formats (MT940, CAMT, BAI2)', 'Cheque & promissory-note handling', 'Islamic finance (Murabaha, Ijarah, sukuk) in SAP', 'Electronic bank communication (SWIFT, host-to-host)', 'Cash management & liquidity reporting'] },
  { group: 'Statutory reporting & accounting', items: ['IFRS & local GAAP parallel ledgers', 'Statutory financial statements (country formats)', 'Fixed assets local depreciation & tax books', 'Chart of accounts localization', 'Intercompany & consolidation (local rules)', 'Digital tax audits & e-books', 'ESG / sustainability reporting (CSRD)'] },
  { group: 'Logistics, trade & other', items: ['Customs, import/export & GCC customs union (GTS)', 'Local excise stamps & track-and-trace', 'Arabic language & right-to-left printing (forms, reports, Fiori)', 'Hijri calendar & dual-date support', 'Localized forms (Smart Forms / Adobe Forms in Arabic)', 'Local content & in-country value (ICV) reporting'] },
  { group: 'Other', items: ['Other'] },
];

/** 6. Extra profile lists (same multi-select pattern, all with an "Other"). PROJECT_TYPE_OPTIONS replaces the old short list of project types. */
export const DEPLOYMENT_EXPERIENCE: string[] = ['On-premise', 'Private cloud (RISE)', 'Public cloud (S/4HANA Cloud)', 'Hybrid', 'SAP BTP side-by-side', 'Other'];

export const PROJECT_TYPE_OPTIONS: string[] = [
  'Implementation (greenfield)', 'Conversion / migration (brownfield)', 'Selective data transition', 'Rollout & global template', 'Upgrade & enhancement packs',
  'Application management (L2/L3 support)', 'Health check & audit', 'Performance & optimization', 'Data migration & cleansing', 'Training & knowledge transfer', 'Testing & quality assurance', 'Project / program management', 'Change management & adoption', 'Other',
];

export const PROJECT_SCALE: string[] = ['Small (under 20 people)', 'Medium (20-100 people)', 'Large (100-300 people)', 'Mega program (over 300 people)'];

export const WORK_MODES: string[] = ['Remote', 'On-site at the client', 'Hybrid'];

export const WORKING_WEEK: string[] = ['Sunday to Thursday', 'Monday to Friday', 'Flexible (both)'];

export const LANGUAGE_LEVELS: string[] = ['Native', 'Fluent (business)', 'Good', 'Basic'];

/** Does the label count as "Other"? (free text) */
export const isOther = (label: string): boolean => label === 'Other';

/** The first part of a label before " - " (for example "Oil & gas" for "Oil & gas - upstream"): used to give half credit to the same industry family. */
export const familyOf = (label: string): string => label.split(' - ')[0].trim();

const allItems = (groups: TaxonomyGroup[]): string[] => groups.flatMap((g) => g.items).filter((x) => !isOther(x));

/** The region group of a localization country ("GCC", "Europe"...), or null when the country is not in the list. */
export const regionOfCountry = (country: string): string | null => {
  const hit = LOCALIZATION_COUNTRIES.find((g) => g.items.includes(country));
  return hit && !isOther(country) ? hit.group : null;
};

/** The group of a customer segment ("Public sector", "Private sector"...), or null for free texts. */
export const segmentFamily = (segment: string): string | null => CUSTOMER_SEGMENTS.find((g) => g.items.includes(segment))?.group ?? null;

export const ALL_INDUSTRIES = allItems(INDUSTRY_EXPERIENCE);
export const ALL_SEGMENTS = allItems(CUSTOMER_SEGMENTS);
export const ALL_VERTICALS = allItems(VERTICAL_SOLUTIONS);
export const ALL_COUNTRIES = allItems(LOCALIZATION_COUNTRIES);
export const ALL_LOCALIZATION_SOLUTIONS = allItems(LOCALIZATION_SOLUTIONS);

