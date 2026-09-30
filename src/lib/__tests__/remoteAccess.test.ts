import { describe, it, expect } from 'vitest';
import {
  buildRdpFileContent,
  buildRemoteUri,
  connectionIdHint,
  isValidConnectionId,
  normalizeConnectionId,
} from '../remoteAccess';

describe('isValidConnectionId', () => {
  it('accepts well-formed IDs for each tool', () => {
    expect(isValidConnectionId('anydesk', '123456789')).toBe(true);
    expect(isValidConnectionId('anydesk', 'sap-prod@ad')).toBe(true);
    expect(isValidConnectionId('teamviewer', '123456789')).toBe(true);
    expect(isValidConnectionId('rustdesk', 'abc123_DEF-45')).toBe(true);
    expect(isValidConnectionId('rdp', 'srv01.corp.example.com:3389')).toBe(true);
    expect(isValidConnectionId('rdp', '192.168.1.100')).toBe(true);
    expect(isValidConnectionId('rdp', 'sap_prd01.corp.local:3389')).toBe(true);
  });

  it('tolerates spaces typed inside numeric IDs', () => {
    expect(isValidConnectionId('teamviewer', '123 456 789')).toBe(true);
    expect(normalizeConnectionId('teamviewer', ' 123 456 789 ')).toBe('123456789');
    expect(normalizeConnectionId('rdp', ' host.example.com ')).toBe('host.example.com');
  });

  it('rejects newline / directive injection (RDP file poisoning)', () => {
    expect(isValidConnectionId('rdp', 'host.example.com\nfull address:s:evil')).toBe(false);
    expect(isValidConnectionId('rdp', 'host.example.com\r\ndrivestoredirect:s:*')).toBe(false);
    expect(buildRdpFileContent('host.example.com\nalternate shell:s:cmd.exe')).toBeNull();
  });

  it('rejects URL / argument injection (protocol handler abuse)', () => {
    expect(isValidConnectionId('teamviewer', '123456789&command=evil')).toBe(false);
    expect(isValidConnectionId('teamviewer', '123456789 --run')).toBe(false);
    expect(isValidConnectionId('rustdesk', 'abc123/../../evil')).toBe(false);
    expect(isValidConnectionId('anydesk', '123456789;calc')).toBe(false);
    expect(isValidConnectionId('rustdesk', 'abc123?x=1#y')).toBe(false);
  });

  it('rejects wrong shapes, out-of-range ports and unknown tools', () => {
    expect(isValidConnectionId('teamviewer', '12345')).toBe(false);
    expect(isValidConnectionId('anydesk', 'abc')).toBe(false);
    expect(isValidConnectionId('rdp', 'host:99999')).toBe(false);
    expect(isValidConnectionId('rdp', '-bad.example.com')).toBe(false);
    expect(isValidConnectionId('rdp', '')).toBe(false);
    expect(isValidConnectionId('ssh', 'host')).toBe(false);
  });
});

describe('buildRemoteUri', () => {
  it('builds protocol links only for valid IDs', () => {
    expect(buildRemoteUri('anydesk', '123456789')).toBe('anydesk:123456789');
    expect(buildRemoteUri('teamviewer', '123 456 789')).toBe('teamviewer10://control?device=123456789');
    expect(buildRemoteUri('rustdesk', 'abc123_DEF')).toBe('rustdesk://connection/new/abc123_DEF');
  });

  it('returns null for invalid IDs and for tools without a link scheme', () => {
    expect(buildRemoteUri('teamviewer', '123&x=1')).toBeNull();
    expect(buildRemoteUri('rdp', 'host.example.com')).toBeNull();
    expect(buildRemoteUri('unknown', '123456789')).toBeNull();
  });
});

describe('buildRdpFileContent', () => {
  it('produces a minimal file for a valid host', () => {
    expect(buildRdpFileContent('srv01.example.com:3389')).toBe(
      'full address:s:srv01.example.com:3389\r\nprompt for credentials:i:1\r\n',
    );
  });
});

describe('connectionIdHint', () => {
  it('has a hint for every known tool', () => {
    expect(connectionIdHint('teamviewer')).toBe('TeamViewer ID: 9-11 digits');
    expect(connectionIdHint('nope')).toBe('Letters, digits and . _ : @ - only');
  });
});
