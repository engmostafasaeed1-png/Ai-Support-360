// The official SAP websites that anyone can open without an SAP login. We only link to them: nothing from them is copied or stored.

export type FreeSourceId = 'help' | 'community' | 'learning' | 'developers';

export interface FreeSapSource {
  id: FreeSourceId;
  name: string;
  /** What the reader finds there, in a few words. */
  what: string;
  /** The home page of the website. */
  home: string;
  /** The only host a link to this website may point to. */
  host: string;
}

export const FREE_SAP_SOURCES: readonly FreeSapSource[] = [
  { id: 'help', name: 'SAP Help Portal', what: 'Official product documentation', home: 'https://help.sap.com/docs', host: 'help.sap.com' },
  { id: 'community', name: 'SAP Community', what: 'Questions and answers from SAP experts and users', home: 'https://community.sap.com/', host: 'community.sap.com' },
  { id: 'learning', name: 'SAP Learning', what: 'Free learning journeys and courses, including openSAP', home: 'https://learning.sap.com/', host: 'learning.sap.com' },
  { id: 'developers', name: 'SAP Developer tutorials', what: 'Free step-by-step tutorials', home: 'https://developers.sap.com/tutorial-navigator/', host: 'developers.sap.com' },
];

export function freeSapSource(id: unknown): FreeSapSource | undefined {
  return FREE_SAP_SOURCES.find(s => s.id === id);
}

/** The link only when it is a plain https address on the website of that source (no login part, no other host). */
export function safeSourceUrl(id: unknown, url: unknown): string | null {
  const source = freeSapSource(id);
  if (!source || typeof url !== 'string' || url.length > 600) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === source.host && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}
