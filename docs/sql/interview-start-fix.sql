-- PREPARED ONLY. Do not apply without owner approval.
-- Run the enum addition before the function calls (the migration must commit first).
alter type public.interview_status add value if not exists 'abandoned';

-- Abandon inactive AI sessions on next open, retaining transcript and answers.
create or replace function public.interview_abandon_stale()
returns integer language plpgsql security definer set search_path = public
as $$
declare affected integer;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  update public.interview_sessions s set status = 'abandoned', updated_at = now()
  where s.consultant_id in (select c.id from public.consultants c where c.user_id = auth.uid())
    and s.interview_type = 'ai' and coalesce(s.interview_style, 'standard') <> 'live'
    and s.status = 'in_progress' and nullif(btrim(s.ai_summary), '') is null
    and coalesce(s.updated_at, s.started_at, s.created_at) < now() - interval '30 minutes';
  get diagnostics affected = row_count;
  return affected;
end $$;
revoke all on function public.interview_abandon_stale() from public, anon;
grant execute on function public.interview_abandon_stale() to authenticated;

create or replace function public.admin_interview_health()
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'))
    then raise exception 'Administrator access required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'last_success', (select max(created_at) from public.audit_logs where action = 'ai_interview_turn_success'),
    'last_error', (select jsonb_build_object('at', created_at, 'status', metadata->'status', 'message', metadata->>'message')
      from public.audit_logs where action = 'ai_interview_turn_error' order by created_at desc limit 1)
  );
end $$;
revoke all on function public.admin_interview_health() from public, anon;
grant execute on function public.admin_interview_health() to authenticated;