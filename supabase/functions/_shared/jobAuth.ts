// Background job callers (pg_cron jobs and pg_net wake-ups from the database) send the private
// `x-job-token` header produced by public.job_invoke_headers(). Only the database and the service role
// can read that token, so a request without it did not come from our own schedule and is refused.

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

const TOKEN_RE = /^[a-f0-9]{64}$/;

export async function isJobCaller(req: Request, admin: ServiceClient): Promise<boolean> {
  const token = req.headers.get('x-job-token') ?? '';
  if (!TOKEN_RE.test(token)) return false;
  try {
    const { data, error } = await admin.rpc('job_token_valid', { _token: token });
    return !error && data === true;
  } catch {
    return false;
  }
}
