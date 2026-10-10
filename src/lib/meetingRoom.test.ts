import { describe, it, expect } from 'vitest';
import { sessionRoomName, sessionRoomUrl } from './meetingRoom';

describe('sessionRoomName', () => {
  it('uses the whole session id without dashes', () => {
    expect(sessionRoomName('0F8ced2a-5969-4d7b-8dfa-ab6f992b3c36')).toBe('ai-support-360-0f8ced2a59694d7b8dfaab6f992b3c36');
  });
  it('makes a full address', () => {
    expect(sessionRoomUrl('a-b')).toBe('https://meet.jit.si/ai-support-360-ab');
  });
});
