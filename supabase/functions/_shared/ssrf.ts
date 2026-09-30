// Outbound URL validation for integrations (SSRF protection).
//
// Customers configure their own helpdesk URL, and the edge function calls it with the
// customer's stored credentials. The URL must therefore be https, credential-free, on the
// default port, on a host that belongs to the selected platform (or is explicitly allow-listed
// by the operator), and must not resolve to a private / loopback / link-local address.

const PLATFORM_HOST_SUFFIXES: Record<string, string[]> = {
  zendesk: ['.zendesk.com'],
  freshdesk: ['.freshdesk.com'],
  jira: ['.atlassian.net', '.jira.com'],
  servicenow: ['.service-now.com', '.servicenowservices.com'],
};

/** Operator-approved exact hostnames for self-hosted / custom-domain instances (comma separated). */
function extraAllowedHosts(): string[] {
  return (Deno.env.get('INTEGRATION_EXTRA_ALLOWED_HOSTS') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10 || a === 127) return true; // "this" network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique local
  if (/^fe[89ab]/.test(v)) return true; // link-local fe80::/10
  if (v.startsWith('ff')) return true; // multicast
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v); // IPv4-mapped
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isPrivateIp(ip: string): boolean {
  return ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/** Synchronous structural checks (no DNS). Throws a user-safe Error when the URL is not acceptable. */
export function assertAllowedPlatformUrl(raw: string, platform: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid platform URL');
  }
  if (u.protocol !== 'https:') throw new Error('Platform URL must use https');
  if (u.username || u.password) throw new Error('Platform URL must not contain credentials');
  if (u.port && u.port !== '443') throw new Error('Platform URL must use the default https port');

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.home.arpa')
  ) {
    throw new Error('Platform URL host is not allowed');
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[')) {
    throw new Error('Platform URL must use a hostname, not an IP address');
  }

  const suffixes = PLATFORM_HOST_SUFFIXES[platform] ?? [];
  const allowed = suffixes.some((s) => host.endsWith(s) && host.length > s.length) || extraAllowedHosts().includes(host);
  if (!allowed) throw new Error('Platform URL host is not allowed for this integration');
  return u;
}

/** Structural checks plus a DNS check so an allowed-looking name cannot point at an internal address. */
export async function assertSafeOutboundUrl(raw: string, platform: string): Promise<URL> {
  const u = assertAllowedPlatformUrl(raw, platform);
  const host = u.hostname.toLowerCase().replace(/\.$/, '');

  // deno-lint-ignore no-explicit-any
  const resolve = (Deno as any).resolveDns as ((h: string, t: string) => Promise<string[]>) | undefined;
  if (typeof resolve === 'function') {
    const ips: string[] = [];
    let lookupFailures = 0;
    for (const type of ['A', 'AAAA']) {
      try {
        ips.push(...(await resolve(host, type)));
      } catch {
        lookupFailures++;
      }
    }
    if (ips.length === 0) {
      // Both lookups failed: either the name does not exist or DNS is unavailable in this runtime.
      if (lookupFailures >= 2) throw new Error('Platform URL host does not resolve');
    }
    if (ips.some(isPrivateIp)) throw new Error('Platform URL resolves to a private address');
  }
  return u;
}

/** Encode a value that is interpolated into a URL path segment. */
export function pathSegment(value: unknown): string {
  return encodeURIComponent(String(value ?? ''));
}

/** Jira project keys are upper-case letters/digits/underscore (max 10 in Jira Cloud; be lenient to 32). */
export function assertJiraProjectKey(key: unknown): string {
  const k = String(key ?? '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{1,31}$/.test(k)) throw new Error('Invalid Jira project key');
  return k;
}
