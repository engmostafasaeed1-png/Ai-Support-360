import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ErrorPayload {
  level?: 'warn' | 'error' | 'fatal';
  source?: string;
  message: string;
  stack?: string;
  url?: string;
  route?: string;
  user_agent?: string;
  context?: Record<string, unknown>;
}

function fingerprint(message: string, stack?: string): string {
  const base = (message || '') + '|' + (stack || '').split('\n').slice(0, 3).join('|');
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as ErrorPayload;
    if (!body?.message || typeof body.message !== 'string') {
      return new Response(JSON.stringify({ error: 'message is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Try to identify the user from the JWT (optional)
    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { data } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
        userId = data.user?.id ?? null;
      } catch {
        /* anonymous */
      }
    }

    const fp = fingerprint(body.message, body.stack);
    const level = body.level ?? 'error';

    // Dedupe: bump occurrence_count for recent same-fingerprint unresolved error (last 1h)
    const { data: existing } = await supabase
      .from('error_reports')
      .select('id, occurrence_count')
      .eq('fingerprint', fp)
      .eq('resolved', false)
      .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('error_reports')
        .update({ occurrence_count: (existing.occurrence_count ?? 1) + 1, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      return new Response(JSON.stringify({ ok: true, id: existing.id, deduped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await supabase
      .from('error_reports')
      .insert({
        level,
        source: body.source ?? 'client',
        message: body.message.slice(0, 4000),
        stack: body.stack?.slice(0, 8000) ?? null,
        url: body.url?.slice(0, 1000) ?? null,
        route: body.route?.slice(0, 500) ?? null,
        user_agent: body.user_agent?.slice(0, 500) ?? null,
        user_id: userId,
        context: body.context ?? {},
        fingerprint: fp,
      })
      .select('id')
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // Never fail loudly: error reporting must not create new errors
    // (e.g. when the database is temporarily unreachable).
    console.error('log-error failed:', e);
    return new Response(JSON.stringify({ ok: false, dropped: true }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
