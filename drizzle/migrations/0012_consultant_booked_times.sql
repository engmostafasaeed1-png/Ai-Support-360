CREATE OR REPLACE FUNCTION public.consultant_booked_times(_consultant_id uuid, _from timestamptz, _to timestamptz)
RETURNS TABLE(scheduled_at timestamptz, duration_minutes integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.scheduled_at, COALESCE(NULLIF(s.duration_minutes, 0), 60)
  FROM public.sessions s
  WHERE auth.uid() IS NOT NULL
    AND s.consultant_id = _consultant_id
    AND s.scheduled_at >= _from AND s.scheduled_at < _to
    AND s.status::text IN ('scheduled', 'active', 'in_progress')
    AND _to - _from <= interval '62 days'
$$;
REVOKE EXECUTE ON FUNCTION public.consultant_booked_times(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_booked_times(uuid, timestamptz, timestamptz) TO authenticated;