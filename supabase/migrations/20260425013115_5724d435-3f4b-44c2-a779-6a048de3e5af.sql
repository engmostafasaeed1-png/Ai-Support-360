CREATE OR REPLACE FUNCTION public.admin_confirm_reschedule_slot(
  _request_id uuid,
  _slot_index integer DEFAULT 0,
  _note text DEFAULT NULL
)
RETURNS public.demo_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.demo_requests;
  _slots jsonb;
  _slot jsonb;
  _date date;
  _time text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can confirm reschedule slots' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _row FROM public.demo_requests WHERE id = _request_id;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'Demo request not found';
  END IF;

  IF _row.status <> 'rescheduling' THEN
    RAISE EXCEPTION 'Demo request is not awaiting reschedule confirmation (current status: %)', _row.status;
  END IF;

  _slots := COALESCE(_row.proposed_slots, '[]'::jsonb);
  IF jsonb_typeof(_slots) <> 'array' OR jsonb_array_length(_slots) = 0 THEN
    RAISE EXCEPTION 'No proposed slots available to confirm';
  END IF;

  IF _slot_index < 0 OR _slot_index >= jsonb_array_length(_slots) THEN
    RAISE EXCEPTION 'Slot index % out of range (0..%)', _slot_index, jsonb_array_length(_slots) - 1;
  END IF;

  _slot := _slots -> _slot_index;
  IF _slot ? 'date' = false OR _slot ? 'time' = false THEN
    RAISE EXCEPTION 'Selected slot is missing date or time';
  END IF;

  BEGIN
    _date := (_slot->>'date')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Selected slot has invalid date: %', _slot->>'date';
  END;
  _time := _slot->>'time';

  UPDATE public.demo_requests
  SET status = 'scheduled',
      scheduled_date = _date,
      scheduled_slot = _time,
      proposed_slots = NULL,
      reschedule_reason = NULL,
      reschedule_requested_at = NULL,
      status_note = COALESCE(NULLIF(btrim(_note), ''),
        'Reschedule confirmed by admin for ' || to_char(_date, 'Mon DD, YYYY') || ' at ' || _time || '.'),
      updated_at = now()
  WHERE id = _request_id
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_confirm_reschedule_slot(uuid, integer, text) TO authenticated;