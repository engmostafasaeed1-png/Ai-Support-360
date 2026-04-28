// Returns the configured email OTP / verification link expiry (in seconds)
// from the Supabase Auth admin settings. This lets the frontend show a real
// countdown instead of assuming 24 hours.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const DEFAULT_EXPIRY_SECONDS = 24 * 60 * 60; // 24h

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const projectRef = Deno.env.get("SUPABASE_URL")?.match(/https?:\/\/([^.]+)\./)?.[1];
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let expirySeconds = DEFAULT_EXPIRY_SECONDS;
  let source: "auth_config" | "default" = "default";

  if (projectRef && serviceRoleKey) {
    try {
      // Supabase exposes auth settings to anon callers at /auth/v1/settings,
      // but it does NOT include otp_exp. The full config (incl. mailer_otp_exp
      // and mailer_otp_length) is available via the Management/auth admin
      // endpoint when authorized with the service role key.
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/admin/config`, {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
      });
      if (res.ok) {
        const cfg = await res.json();
        // Field names per GoTrue: MAILER_OTP_EXP (seconds)
        const otpExp = cfg?.MAILER_OTP_EXP ?? cfg?.mailer_otp_exp;
        if (typeof otpExp === "number" && otpExp > 0) {
          expirySeconds = otpExp;
          source = "auth_config";
        }
      }
    } catch (_e) {
      // fall through to default
    }
  }

  return new Response(
    JSON.stringify({
      expiry_seconds: expirySeconds,
      expiry_minutes: Math.round(expirySeconds / 60),
      source,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    },
  );
});
