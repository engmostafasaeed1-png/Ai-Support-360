import { describe, expect, it } from 'vitest';
import { cleanNoticeText, isTestNotice, noticeBlocks, noticePreview } from './noticeText';

describe('notice text', () => {
  it('greets with the first name or with no name - never "Hello ,"', () => {
    expect(cleanNoticeText('Hello {{first_name}},\n\nYou are invited.', { firstName: 'Ezz Saeed' })).toBe('Hello Ezz,\n\nYou are invited.');
    expect(cleanNoticeText('Hello {{first_name}},\n\nYou are invited.')).toBe('Hello,\n\nYou are invited.');
    expect(cleanNoticeText('Hello ,\n\nYou are invited.')).toBe('Hello,\n\nYou are invited.');
    expect(cleanNoticeText('مرحبًا {{first_name}}،\n\nأنت مدعو.')).toBe('مرحبًا،\n\nأنت مدعو.');
  });

  it('drops the stray trailing ";" left by a cut text and unknown placeholders', () => {
    expect(cleanNoticeText('Rewards depend on approved, paid work;')).toBe('Rewards depend on approved, paid work');
    expect(cleanNoticeText('Open: {{unknown}}')).toBe('Open');
  });

  it('splits the message into short paragraphs and bullet lists', () => {
    const blocks = noticeBlocks('Hello,\n\nYou are invited.\n\n- Share your code.\n- Earn on paid work;\n\nOpen Refer & earn: https://www.aisupport360.com/consultant/referrals', { dropLinks: true });
    expect(blocks).toEqual([
      { type: 'p', text: 'Hello,' },
      { type: 'p', text: 'You are invited.' },
      { type: 'ul', items: ['Share your code.', 'Earn on paid work'] },
    ]);
  });

  it('a compact preview has no greeting and no web address', () => {
    expect(noticePreview('Hello,\n\nYou are invited to Refer & earn.\n\nOpen: https://www.aisupport360.com/x')).toBe('You are invited to Refer & earn.');
  });

  it('test notices are recognised by the [TEST] prefix or the database flag', () => {
    expect(isTestNotice({ title: '[TEST] Invitation' })).toBe(true);
    expect(isTestNotice({ title: 'Invitation', is_test: true })).toBe(true);
    expect(isTestNotice({ title: 'Invitation' })).toBe(false);
  });
});
