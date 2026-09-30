/**
 * Validation and link construction for remote-access tools (AnyDesk, TeamViewer, RustDesk, RDP/VNC).
 *
 * Connection IDs are entered by one user and used by another user's browser to build
 * teamviewer:// / rustdesk:// / anydesk: links and .rdp files. They are therefore validated
 * against a strict per-tool pattern and never interpolated unvalidated. The database enforces a
 * looser superset of these rules (^[A-Za-z0-9._:@-]{3,128}$) as a second line of defence.
 */

export type RemoteTool = 'anydesk' | 'teamviewer' | 'rustdesk' | 'rdp' | 'vnc';

const HOST = '[A-Za-z0-9](?:[A-Za-z0-9._-]{0,251}[A-Za-z0-9])?';

const PATTERNS: Record<RemoteTool, RegExp> = {
  // numeric address or alias@ad
  anydesk: /^(?:\d{6,12}|[A-Za-z0-9._-]{1,64}@ad)$/,
  teamviewer: /^\d{9,11}$/,
  rustdesk: /^[A-Za-z0-9_-]{6,64}$/,
  // host[:port]
  rdp: new RegExp(`^${HOST}(?::\\d{1,5})?$`),
  vnc: new RegExp(`^${HOST}(?::\\d{1,5})?$`),
};

export function isRemoteTool(value: string): value is RemoteTool {
  return value in PATTERNS;
}

/** Trim, and remove the spaces people type inside numeric IDs ("123 456 789"). */
export function normalizeConnectionId(tool: string, raw: string): string {
  const trimmed = (raw ?? '').trim();
  return tool === 'anydesk' || tool === 'teamviewer' ? trimmed.replace(/\s+/g, '') : trimmed;
}

export function isValidConnectionId(tool: string, raw: string): boolean {
  if (!isRemoteTool(tool)) return false;
  const id = normalizeConnectionId(tool, raw);
  if (!PATTERNS[tool].test(id)) return false;
  if (tool === 'rdp' || tool === 'vnc') {
    const port = id.split(':')[1];
    if (port !== undefined && Number(port) > 65535) return false;
  }
  return true;
}

export function connectionIdHint(tool: string): string {
  switch (tool) {
    case 'anydesk':
      return 'AnyDesk address: 6-12 digits, or alias@ad';
    case 'teamviewer':
      return 'TeamViewer ID: 9-11 digits';
    case 'rustdesk':
      return 'RustDesk ID: 6-64 letters, digits, - or _';
    case 'rdp':
    case 'vnc':
      return 'Hostname or IP address, optionally followed by :port';
    default:
      return 'Letters, digits and . _ : @ - only';
  }
}

/** Returns the protocol link for a validated ID, or null when the ID is not valid. */
export function buildRemoteUri(tool: string, raw: string): string | null {
  if (!isValidConnectionId(tool, raw)) return null;
  const id = normalizeConnectionId(tool, raw);
  switch (tool) {
    case 'anydesk':
      return `anydesk:${id}`;
    case 'teamviewer':
      return `teamviewer10://control?device=${encodeURIComponent(id)}`;
    case 'rustdesk':
      return `rustdesk://connection/new/${encodeURIComponent(id)}`;
    default:
      return null;
  }
}

/** Minimal, safe .rdp file content for host[:port]; null when the host is not valid. */
export function buildRdpFileContent(hostAndPort: string): string | null {
  if (!isValidConnectionId('rdp', hostAndPort)) return null;
  return `full address:s:${hostAndPort.trim()}\r\nprompt for credentials:i:1\r\n`;
}
