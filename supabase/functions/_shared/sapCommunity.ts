// Live look-up in SAP Community's public search. It runs only when an administrator has switched it on.
// Only a few generic search words leave this server. Only titles and links come back, nothing is stored and nothing goes to the AI:
// the discussions stay on SAP's website, the reader opens them there.
import { cleanSearchTerms } from "./sapRefs.ts";

export interface CommunityHit {
  title: string;
  url: string;
  solved: boolean;
}

interface RawItem {
  subject?: unknown;
  view_href?: unknown;
  message_type?: unknown;
  post_time?: unknown;
  conversation?: { solved?: unknown };
}

const API = "https://community.sap.com/api/2.0/search";
const SITE = "https://community.sap.com/";
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; hits: CommunityHit[] }>();

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A title from the search answer: tags and entities removed, spaces collapsed, at most 140 characters. */
export function cleanTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole: string, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      }
      return NAMED[e.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

/** The query for topics whose title contains ALL the words (a leading + means "must match"). The words must already be clean. */
export function buildQuery(terms: readonly string[], limit = 20): string {
  const words = terms.map((t) => `+${t}`).join(" ");
  return `SELECT id, subject, view_href, conversation.solved, post_time, message_type FROM messages WHERE depth = 0 AND subject MATCHES '${words}' LIMIT ${limit}`;
}

/** Solved questions first, then other questions, then newer before older; only links on SAP Community itself. */
export function rankHits(items: readonly RawItem[], max = 3): CommunityHit[] {
  const seen = new Set<string>();
  const hits: Array<CommunityHit & { time: string; question: boolean }> = [];
  for (const i of items) {
    const url = typeof i?.view_href === "string" ? i.view_href : "";
    const title = cleanTitle(i?.subject);
    if (!url.startsWith(SITE) || url.length > 600 || !title || seen.has(url)) continue;
    seen.add(url);
    hits.push({
      title,
      url,
      solved: i?.conversation?.solved === true,
      time: String(i?.post_time ?? ""),
      question: i?.message_type === "forum_topic_message",
    });
  }
  hits.sort((a, b) => Number(b.solved) - Number(a.solved) || Number(b.question) - Number(a.question) || b.time.localeCompare(a.time));
  return hits.slice(0, max).map(({ title, url, solved }) => ({ title, url, solved }));
}

async function ask(doFetch: typeof fetch, terms: readonly string[], timeoutMs: number): Promise<CommunityHit[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(`${API}?q=${encodeURIComponent(buildQuery(terms))}`, {
      headers: { Accept: "application/json", "User-Agent": "AI-SAP-Support-Now/1.0 (support portal; https://www.aisapsupportnow.com)" },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("SAP Community search answered", res.status);
      return null;
    }
    const data = await res.json();
    return rankHits(Array.isArray(data?.data?.items) ? data.data.items : []);
  } catch (e) {
    console.warn("SAP Community search failed:", e instanceof Error ? e.name : "error");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Up to 3 matching discussions. It asks with all the words first and, when that finds fewer than 3, again with fewer words.
 * An answer is remembered for 10 minutes. When SAP Community does not answer, the result is an empty list.
 */
export async function searchCommunity(
  termsRaw: readonly string[],
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number } = {},
): Promise<CommunityHit[]> {
  const terms = cleanSearchTerms(termsRaw, new Set(), 4);
  if (terms.length < 2) return [];
  const now = opts.now ?? Date.now;
  const key = terms.join(" ");
  const known = cache.get(key);
  if (known && now() - known.at < CACHE_MS) return known.hits;

  const doFetch = opts.fetchImpl ?? fetch;
  const sizes = [...new Set([terms.length, 3, 2])].filter((n) => n >= 2 && n <= terms.length).sort((a, b) => b - a);
  let best: CommunityHit[] = [];
  for (const n of sizes) {
    const hits = await ask(doFetch, terms.slice(0, n), opts.timeoutMs ?? 3500);
    if (hits === null) return best; // no answer: stop, do not ask again and again
    if (hits.length > best.length) best = hits;
    if (best.length >= 3) break;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: now(), hits: best });
  return best;
}

/** For tests: forget the remembered answers. */
export function clearCommunityCache(): void {
  cache.clear();
}
