// LinkedIn import has been withdrawn.
//
// The previous implementation did not read the LinkedIn profile at all: it asked an AI model to
// invent a plausible consultant profile from the URL slug (employers, certifications, skills),
// which would then be presented as imported data on a platform that sells "verified SAP experts".
// Until a legitimate, consented data source is integrated this endpoint refuses the request.
import { jsonResponse, preflight } from '../_shared/security.ts';

Deno.serve((req) => {
  const pre = preflight(req);
  if (pre) return pre;
  return jsonResponse(
    req,
    {
      error:
        'LinkedIn import is no longer available. Upload your CV for AI-assisted parsing or enter your profile details manually.',
    },
    410,
  );
});
