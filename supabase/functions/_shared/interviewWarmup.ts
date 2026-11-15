export type InterviewAccess = { owner: boolean; admin: boolean; interviewer: boolean };

export function interviewAccessAllowed(access: InterviewAccess, action?: string): boolean {
  return action === 'copilot' ? access.admin || access.interviewer : access.owner || access.admin;
}

/** Caller supplies freshly checked access; never fetch private context for a stranger. */
export async function warmInterviewContext(access: InterviewAccess, load: () => Promise<unknown>, headers: HeadersInit): Promise<Response> {
  if (!interviewAccessAllowed(access, 'warmup')) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers });
  }
  await load();
  return new Response(null, { status: 204, headers });
}