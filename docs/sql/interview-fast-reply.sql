-- PREPARED ONLY: do not apply or publish until owner approval.
-- Reuses interview-start-fix's health RPC and existing audit events; no new tables.
create or replace function public.admin_interview_health()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'))
    then raise exception 'Administrator access required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'last_success', (select max(created_at) from public.audit_logs where action = 'ai_interview_turn_success'),
    'average_ms', (select avg((metadata->>'first_text_ms')::numeric) from public.audit_logs
      where action = 'ai_interview_turn_success' and created_at > now() - interval '7 days' and jsonb_typeof(metadata->'first_text_ms') = 'number'),
    'p95_ms', (select percentile_cont(0.95) within group(order by (metadata->>'first_text_ms')::double precision) from public.audit_logs
      where action = 'ai_interview_turn_success' and created_at > now() - interval '7 days' and jsonb_typeof(metadata->'first_text_ms') = 'number'),
    'last_error', (select jsonb_build_object('at', created_at, 'status', metadata->'status', 'message', metadata->>'message')
      from public.audit_logs where action = 'ai_interview_turn_error' order by created_at desc limit 1)
  );
end $$;
revoke all on function public.admin_interview_health() from public, anon;
grant execute on function public.admin_interview_health() to authenticated;