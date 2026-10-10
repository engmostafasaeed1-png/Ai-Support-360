/**
 * The Jitsi room of a session. The name is the whole session id (122 random bits), so nobody can guess the room from a part of the id.
 */
export function sessionRoomName(sessionId: string): string {
  return `ai-support-360-${sessionId.replace(/[^0-9a-zA-Z]/g, '').toLowerCase()}`;
}

export function sessionRoomUrl(sessionId: string): string {
  return `https://meet.jit.si/${sessionRoomName(sessionId)}`;
}
