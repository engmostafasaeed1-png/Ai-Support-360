// Edge function: log-logo-upload
// Records each company logo upload attempt for debugging.
// Uses the caller's JWT so RLS enforces user_id ownership on insert.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

interface LogPayload {
  bucket?: string;
  path?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  success?: boolean;
  error_code?: string | null;
  error_message?: string | null;
}

function bad(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') return bad(405, 'Method not allowed');

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return bad(401, 'Missing Authorization');

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return bad(401, 'Invalid user');
  const user = userData.user;

  let body: LogPayload;
  try {
    body = (await req.json()) as LogPayload;
  } catch {
    return bad(400, 'Invalid JSON');
  }

  const bucket = (body.bucket || '').toString().slice(0, 100);
  const path = (body.path || '').toString().slice(0, 500);
  if (!bucket || !path) return bad(400, 'bucket and path are required');

  const row = {
    user_id: user.id,
    bucket,
    path,
    file_name: body.file_name?.toString().slice(0, 255) ?? null,
    file_type: body.file_type?.toString().slice(0, 100) ?? null,
    file_size:
      typeof body.file_size === 'number' && Number.isFinite(body.file_size)
        ? Math.max(0, Math.floor(body.file_size))
        : null,
    success: !!body.success,
    error_code: body.error_code ? String(body.error_code).slice(0, 100) : null,
    error_message: body.error_message
      ? String(body.error_message).slice(0, 1000)
      : null,
    user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
  };

  // Structured log line — visible in edge function logs.
  console.log(
    JSON.stringify({
      tag: 'logo_upload_attempt',
      user_id: row.user_id,
      bucket: row.bucket,
      path: row.path,
      file_type: row.file_type,
      file_size: row.file_size,
      success: row.success,
      error_code: row.error_code,
      error_message: row.error_message,
    })
  );

  const { error: insertErr } = await supabase
    .from('logo_upload_attempts')
    .insert(row);

  if (insertErr) {
    console.error('logo_upload_attempt insert failed', insertErr);
    return new Response(
      JSON.stringify({ ok: false, error: insertErr.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
