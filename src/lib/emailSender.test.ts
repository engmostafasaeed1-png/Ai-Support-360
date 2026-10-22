import { describe, expect, it } from 'vitest';
import { fromHeader, senderFromSettings, senderProblems } from '../../supabase/functions/_shared/emailSender';
import { ownMailLink } from '@/components/referral/EmailInviteForm';

describe('e-mail sender settings', () => {
  it('defaults: "AI Support 360" <noreply@aisupport360.com>, Reply-To and contact info@aisupport360.com', () => {
    expect(senderFromSettings([])).toEqual({ displayName: 'AI Support 360', fromLocal: 'noreply', replyTo: 'info@aisupport360.com', contactEmail: 'info@aisupport360.com' });
    expect(fromHeader()).toBe('"AI Support 360" <noreply@aisupport360.com>');
  });
  it('From must be on the verified domain aisupport360.com', () => {
    expect(senderProblems({ from: 'info@aisupport360.com' })).toEqual([]);
    expect(senderProblems({ from: 'info@gmail.com' })).toEqual(['from_domain_not_verified']);
    expect(senderProblems({ from: 'not an address' })).toEqual(['from_format']);
    expect(senderFromSettings([{ key: 'email_sender_from', value: 'info@other.example' }]).fromLocal).toBe('noreply');
    expect(senderFromSettings([{ key: 'email_sender_from', value: 'info@aisupport360.com' }]).fromLocal).toBe('info');
  });
  it('Reply-To and contact only on our own domain; display name cannot inject header syntax', () => {
    expect(senderProblems({ replyTo: 'support@evil.example' })).toEqual(['reply_to']);
    expect(senderProblems({ contactEmail: 'info@aisupport360.com' })).toEqual([]);
    expect(senderProblems({ displayName: 'Evil" <x@evil.example>' })).toEqual(['display_name']);
    expect(fromHeader('Bad\r\nBcc: x@y.z', 'noreply')).toBe('"AI Support 360" <noreply@aisupport360.com>');
    expect(fromHeader('AI Support 360 Team', 'info')).toBe('"AI Support 360 Team" <info@aisupport360.com>');
  });
});

describe('inviting colleagues who are not registered', () => {
  it('opens the person\'s own mail app (mailto) with subject and body - nothing is sent by the platform', () => {
    const l = ownMailLink(['a@x.com', 'bad', 'b@y.org'], 'Join me', 'Hi & welcome');
    expect(l.startsWith('mailto:a%40x.com,b%40y.org?')).toBe(true);
    expect(l).toContain('subject=Join%20me');
    expect(l).toContain('body=Hi%20%26%20welcome');
  });
});
