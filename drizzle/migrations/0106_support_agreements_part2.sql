-- ------------------------------------------------------------------------------------------------ client: request
-- New draft (request details shown to applicants + the draft terms). Company owner/admin or own-account client.
-- The name is required and unique per client company; the reference number is assigned automatically.
CREATE OR REPLACE FUNCTION public.sa_create(_tenant uuid, _request jsonb, _terms jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); new_id uuid; nm text := left(btrim(COALESCE(_terms ->> 'name', '')), 120); t jsonb;
BEGIN
  IF NOT public.sa_enabled() THEN RAISE EXCEPTION 'sa_disabled' USING ERRCODE = '55000'; END IF;
  IF NOT public.sa_can_manage(uid, _tenant, CASE WHEN _tenant IS NULL THEN uid END) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_rate_ok('sa_create:' || uid, 20, 86400) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  IF char_length(nm) < 1 THEN RAISE EXCEPTION 'sa_terms_invalid: name' USING ERRCODE = '22023'; END IF;
  IF public.sa_name_taken(_tenant, uid, nm, NULL) THEN RAISE EXCEPTION 'sa_name_taken' USING ERRCODE = '23505'; END IF;
  t := public.sa_prepare_terms(_tenant, uid, _terms, _request, NULL);
  INSERT INTO public.sa_agreements (tenant_id, client_id, name, request, terms, created_by)
  VALUES (_tenant, uid, nm, COALESCE(_request, '{}'::jsonb), t || jsonb_build_object('name', nm), uid)
  RETURNING sa_agreements.id INTO new_id;
  UPDATE public.sa_agreements SET terms = terms || jsonb_build_object('reference', reference) WHERE id = new_id;
  PERFORM public.sa_event(new_id, 'created', uid);
  PERFORM public.sa_audit_log(uid, 'create', new_id);
  RETURN new_id;
END $$;

-- Save the draft at any time. The name can change only while the agreement is a Draft (unique per company).
CREATE OR REPLACE FUNCTION public.sa_save_draft(_id uuid, _request jsonb, _terms jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; nm text := left(btrim(COALESCE(_terms ->> 'name', '')), 120); t jsonb;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF a.id IS NULL OR public.sa_role(_id, uid) <> 'client' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF a.status NOT IN ('draft', 'open') THEN RAISE EXCEPTION 'sa_locked: terms change through offers once negotiation starts' USING ERRCODE = '55000'; END IF;
  IF nm = '' THEN nm := a.name; END IF;
  IF nm IS DISTINCT FROM a.name THEN
    IF a.status <> 'draft' THEN RAISE EXCEPTION 'sa_name_locked: the name can only change in Draft' USING ERRCODE = '55000'; END IF;
    IF public.sa_name_taken(a.tenant_id, a.client_id, nm, _id) THEN RAISE EXCEPTION 'sa_name_taken' USING ERRCODE = '23505'; END IF;
  END IF;
  t := public.sa_prepare_terms(a.tenant_id, a.client_id, COALESCE(_terms, a.terms), _request, NULL);
  UPDATE public.sa_agreements SET request = COALESCE(_request, request), terms = t || jsonb_build_object('name', nm, 'reference', a.reference),
         name = nm, updated_at = now() WHERE id = _id;
  PERFORM public.sa_audit_log(uid, 'save_draft', _id);
END $$;

-- Open for applications (all matched consultants, or only invited favourites).
CREATE OR REPLACE FUNCTION public.sa_publish(_id uuid, _deadline timestamptz, _invite_only boolean, _invite uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; probs text[]; c uuid; n int := 0;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF a.id IS NULL OR public.sa_role(_id, uid) <> 'client' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  probs := array_remove(array_remove(array_remove(public.sa_terms_problems(a.terms), 'rate_low'), 'rate_high'), 'currency');  -- rate comes from applications
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_terms_invalid: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  IF _deadline IS NOT NULL AND (_deadline < now() + interval '1 hour' OR _deadline > now() + interval '90 days') THEN RAISE EXCEPTION 'sa_bad_deadline' USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_agreements SET invite_only = COALESCE(_invite_only, false), deadline = _deadline WHERE id = _id;
  FOREACH c IN ARRAY COALESCE(_invite, '{}') LOOP
    INSERT INTO public.sa_invites (agreement_id, consultant_id) VALUES (_id, c) ON CONFLICT DO NOTHING;
    PERFORM public.sa_notify(_id, public.sa_user_of(c), 'Support agreement invitation', 'دعوة إلى اتفاقية دعم',
      'A client invites you to apply for a long-term support agreement: ' || a.name, 'يدعوك عميل إلى التقدّم لاتفاقية دعم طويلة الأمد: ' || a.name,
      'consultant', true, 'invite:' || _id || ':' || c);
    n := n + 1;
  END LOOP;
  PERFORM public.sa_set_status(_id, 'open', uid, jsonb_build_object('invited', n, 'invite_only', COALESCE(_invite_only, false)));
  RETURN jsonb_build_object('invited', n);
END $$;

-- ------------------------------------------------------------------------------------------------ consultant: opportunities + applications
CREATE OR REPLACE FUNCTION public.sa_opportunities()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF public.sa_consultant_of(uid) IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'reference', a.reference, 'request', a.request - CASE WHEN COALESCE((a.request ->> 'show_budget')::boolean, false) THEN '' ELSE 'budget' END,
      'modules', to_jsonb(public.sa_modules(a)), 'model', a.terms ->> 'model', 'term', a.terms -> 'term', 'sla', (a.terms -> 'sla') - 'body', 'deadline', a.deadline,
      'invited', EXISTS (SELECT 1 FROM public.sa_invites i WHERE i.agreement_id = a.id AND i.consultant_id = public.sa_consultant_of(uid)),
      'applied', EXISTS (SELECT 1 FROM public.sa_applications p WHERE p.agreement_id = a.id AND p.consultant_id = public.sa_consultant_of(uid)),
      'role', public.sa_role(a.id, uid)) ORDER BY a.deadline NULLS LAST)
    FROM public.sa_agreements a WHERE a.status = 'open' AND public.sa_role(a.id, uid) IN ('candidate', 'applicant') AND (a.deadline IS NULL OR a.deadline > now())), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.sa_apply(_id uuid, _rate numeric, _currency text, _model text, _capacity numeric, _availability text, _sla_accepted boolean, _message text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; cid uuid := public.sa_consultant_of(uid); probs text[]; new_id uuid; s jsonb := public.sa_settings();
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF a.id IS NULL OR public.sa_role(_id, uid) NOT IN ('candidate', 'applicant') OR a.status <> 'open' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF a.deadline IS NOT NULL AND a.deadline < now() THEN RAISE EXCEPTION 'sa_deadline_passed' USING ERRCODE = '55000'; END IF;
  IF NOT public.sa_rate_ok('sa_apply:' || uid, COALESCE((s ->> 'application_limit_per_day')::int, 10), 86400) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  IF _sla_accepted IS NOT TRUE THEN RAISE EXCEPTION 'sa_sla_acceptance_required' USING ERRCODE = '22023'; END IF;
  IF NOT (COALESCE(s -> 'models_enabled', '[]'::jsonb) ? _model) THEN RAISE EXCEPTION 'sa_model_disabled' USING ERRCODE = '22023'; END IF;
  IF COALESCE(_currency, '') !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'sa_bad_currency' USING ERRCODE = '22023'; END IF;
  probs := public.sa_rate_problems(_rate, NULL, NULL, NULL, public.sa_modules(a));
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_rate_out_of_bounds: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_text_ok(concat_ws(' ', _message, _availability)) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sa_applications (agreement_id, consultant_id, user_id, hourly_rate, currency, model, capacity_hours_per_week, availability_note, sla_accepted_at, sla_summary, message)
  VALUES (_id, cid, uid, round(_rate, 2), _currency, _model, _capacity, left(COALESCE(_availability, ''), 500), now(), COALESCE(a.terms -> 'sla' ->> 'summary', ''), left(COALESCE(_message, ''), 2000))
  ON CONFLICT (agreement_id, consultant_id) DO UPDATE SET hourly_rate = EXCLUDED.hourly_rate, currency = EXCLUDED.currency, model = EXCLUDED.model,
    capacity_hours_per_week = EXCLUDED.capacity_hours_per_week, availability_note = EXCLUDED.availability_note, sla_accepted_at = now(), message = EXCLUDED.message,
    status = CASE WHEN sa_applications.status IN ('withdrawn', 'declined') THEN 'pending' ELSE sa_applications.status END, updated_at = now()
  RETURNING sa_applications.id INTO new_id;
  PERFORM public.sa_event(_id, 'applied', uid);
  PERFORM public.sa_notify(_id, a.client_id, 'New application: ' || a.name, 'طلب جديد: ' || a.name, 'A consultant applied for your support agreement.',
    'تقدّم استشاري لاتفاقية الدعم الخاصة بك.', 'client', false, 'applied:' || new_id || ':' || extract(epoch FROM now())::bigint / 3600);
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.sa_withdraw_application(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  UPDATE public.sa_applications SET status = 'withdrawn', updated_at = now()
   WHERE agreement_id = _id AND consultant_id = public.sa_consultant_of(uid) AND status IN ('pending', 'shortlisted');
  IF NOT FOUND THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.sa_event(_id, 'application_withdrawn', uid);
END $$;

-- Client picks an application -> negotiating with that consultant; the proposed rate/model become the terms (v1).
CREATE OR REPLACE FUNCTION public.sa_select_application(_application uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sa_applications; a public.sa_agreements; t jsonb; v int;
BEGIN
  SELECT * INTO p FROM public.sa_applications WHERE id = _application FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = p.agreement_id FOR UPDATE;
  IF public.sa_role(a.id, uid) <> 'client' OR a.status <> 'open' OR p.status NOT IN ('pending', 'shortlisted') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  t := a.terms || jsonb_build_object('model', p.model,
         'rate', COALESCE(a.terms -> 'rate', '{}'::jsonb) || jsonb_build_object('hourly_rate', p.hourly_rate, 'currency', p.currency),
         'capacity_hours_per_week', COALESCE(to_jsonb(p.capacity_hours_per_week), a.terms -> 'capacity_hours_per_week'),
         -- the selected consultant becomes the lead; the crew the client planned stays (without the new lead)
         'team', jsonb_build_array(jsonb_build_object('consultant_id', p.consultant_id, 'role', 'lead', 'required', true, 'capacity_hours_per_week', p.capacity_hours_per_week))
                 || COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(a.terms -> 'team', '[]'::jsonb)) e
                               WHERE e ->> 'consultant_id' <> p.consultant_id::text AND COALESCE(e ->> 'role', '') <> 'lead'), '[]'::jsonb));
  UPDATE public.sa_agreements SET consultant_id = p.consultant_id, application_id = p.id WHERE id = a.id;
  UPDATE public.sa_applications SET status = 'selected', updated_at = now() WHERE id = p.id;
  PERFORM public.sa_set_status(a.id, 'negotiating', uid, jsonb_build_object('application', p.id));
  v := public.sa_new_version(a.id, t, uid, 'Application selected');
  PERFORM public.sa_notify(a.id, p.user_id, 'You were selected: ' || a.name, 'تم اختيارك: ' || a.name,
    'The client chose your application. Review the terms, counter if needed, and accept.', 'اختار العميل طلبك. راجع الشروط وقدّم عرضاً مقابلاً عند الحاجة ثم اقبل.',
    'consultant', true, 'selected:' || p.id);
  RETURN v;
END $$;

-- Back to applications (e.g. negotiation failed): the selected application is declined, nothing was agreed.
CREATE OR REPLACE FUNCTION public.sa_reopen(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF public.sa_role(_id, uid) NOT IN ('client', 'lead') OR a.status <> 'negotiating' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.sa_applications SET status = 'declined', updated_at = now() WHERE id = a.application_id;
  UPDATE public.sa_offers SET status = 'superseded' WHERE agreement_id = _id AND status = 'open';
  UPDATE public.sa_agreements SET consultant_id = NULL, application_id = NULL WHERE id = _id;
  PERFORM public.sa_set_status(_id, 'open', uid, jsonb_build_object('reason', left(_reason, 300)));
END $$;

-- ------------------------------------------------------------------------------------------------ negotiation
CREATE OR REPLACE FUNCTION public.sa_offer(_id uuid, _patch jsonb, _note text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; r text := public.sa_role(_id, uid); probs text[]; new_id uuid;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF r NOT IN ('client', 'lead') OR a.status <> 'negotiating' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_rate_ok('sa_offer:' || uid, 20, 86400) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  IF NOT public.sa_text_ok(_note) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  probs := public.sa_terms_problems(public.sa_apply_patch(a.terms, _patch));
  IF _patch ? 'team' THEN   -- the crew is composed by the client; the lead must stay in it
    IF r <> 'client' THEN RAISE EXCEPTION 'sa_forbidden: only the client changes the crew' USING ERRCODE = '42501'; END IF;
    probs := probs || public.sa_crew_problems(a.tenant_id, a.client_id, _patch -> 'team', a.consultant_id);
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_patch -> 'team') e WHERE e ->> 'consultant_id' = a.consultant_id::text AND e ->> 'role' = 'lead') THEN
      probs := array_append(probs, 'crew_lead_missing');
    END IF;
  END IF;
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_terms_invalid: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_offers SET status = 'superseded' WHERE agreement_id = _id AND status = 'open';
  INSERT INTO public.sa_offers (agreement_id, by_role, by_user, patch, note) VALUES (_id, public.sa_party(r), uid, _patch, left(COALESCE(_note, ''), 1000))
  RETURNING sa_offers.id INTO new_id;
  PERFORM public.sa_event(_id, 'offer', uid, jsonb_build_object('patch', _patch));
  PERFORM public.sa_audit_log(uid, 'counter', _id, jsonb_build_object('patch', _patch));
  IF r = 'client' THEN
    PERFORM public.sa_notify(_id, public.sa_user_of(a.consultant_id), 'Counter-offer: ' || a.name, 'عرض مقابل: ' || a.name,
      'The client proposes different terms. Please accept or counter.', 'يقترح العميل شروطاً مختلفة. يرجى القبول أو تقديم عرض مقابل.', 'consultant', true, 'offer:' || new_id);
  ELSE
    PERFORM public.sa_notify(_id, a.client_id, 'Counter-offer: ' || a.name, 'عرض مقابل: ' || a.name,
      'The consultant proposes different terms. Please accept or counter.', 'يقترح الاستشاري شروطاً مختلفة. يرجى القبول أو تقديم عرض مقابل.', 'client', true, 'offer:' || new_id);
  END IF;
  RETURN new_id;
END $$;

-- Only the OTHER party may accept or decline an offer; acceptance creates a new terms version (acceptances reset).
CREATE OR REPLACE FUNCTION public.sa_respond_offer(_offer uuid, _accept boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); o public.sa_offers; a public.sa_agreements; r text; v int;
BEGIN
  SELECT * INTO o FROM public.sa_offers WHERE id = _offer FOR UPDATE;
  IF o.id IS NULL OR o.status <> 'open' THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = o.agreement_id FOR UPDATE;
  r := public.sa_role(a.id, uid);
  IF a.status <> 'negotiating' OR r NOT IN ('client', 'lead') OR public.sa_party(r) = o.by_role THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.sa_offers SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END, responded_by = uid, responded_at = now() WHERE id = _offer;
  IF _accept THEN
    v := public.sa_new_version(a.id, public.sa_apply_patch(a.terms, o.patch), uid, 'Offer accepted');
  END IF;
  PERFORM public.sa_event(a.id, CASE WHEN _accept THEN 'offer_accepted' ELSE 'offer_declined' END, uid);
  RETURN COALESCE(v, a.version);
END $$;

-- Electronic acceptance of one terms version (checkbox + typed name + timestamp + content hash). When both parties
-- accepted the same version the agreement is Agreed: immutable agreed rate record, other applications declined.
CREATE OR REPLACE FUNCTION public.sa_accept_terms(_id uuid, _version integer, _hash text, _typed_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; r text := public.sa_role(_id, uid); v public.sa_versions; probs text[]; first_pair boolean; rid uuid; s jsonb := public.sa_settings(); te jsonb;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF r NOT IN ('client', 'lead') OR a.status <> 'negotiating' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.sa_versions WHERE agreement_id = _id AND version = a.version;
  IF v.version IS NULL OR _version <> a.version OR _hash IS DISTINCT FROM v.content_hash THEN
    RAISE EXCEPTION 'sa_version_changed: the terms changed, please review version %', a.version USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sa_offers o WHERE o.agreement_id = _id AND o.status = 'open') THEN RAISE EXCEPTION 'sa_open_offer: answer the open offer first' USING ERRCODE = '55000'; END IF;
  probs := public.sa_terms_problems(a.terms);
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_terms_invalid: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  IF char_length(btrim(COALESCE(_typed_name, ''))) < 2 OR NOT public.sa_text_ok(_typed_name) THEN RAISE EXCEPTION 'sa_name_required' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sa_acceptances (agreement_id, version, content_hash, party, user_id, typed_name, legal_draft)
  VALUES (_id, a.version, v.content_hash, public.sa_party(r), uid, left(btrim(_typed_name), 120), COALESCE((s ->> 'draft_legal_flag')::boolean, true))
  ON CONFLICT (agreement_id, version, party) DO NOTHING;
  PERFORM public.sa_event(_id, 'accepted', uid, jsonb_build_object('version', a.version, 'party', public.sa_party(r)));
  PERFORM public.sa_audit_log(uid, 'accept', _id, jsonb_build_object('version', a.version, 'hash', v.content_hash));
  IF (SELECT count(DISTINCT party) FROM public.sa_acceptances x WHERE x.agreement_id = _id AND x.version = a.version) < 2 THEN
    RETURN jsonb_build_object('agreed', false, 'waiting_for', CASE WHEN public.sa_party(r) = 'client' THEN 'consultant' ELSE 'client' END);
  END IF;
  first_pair := NOT EXISTS (SELECT 1 FROM public.sa_agreements o WHERE o.id <> _id AND o.consultant_id = a.consultant_id AND o.agreed_at IS NOT NULL
                              AND ((a.tenant_id IS NOT NULL AND o.tenant_id = a.tenant_id) OR o.client_id = a.client_id));
  INSERT INTO public.sa_rate_records (agreement_id, seq, hourly_rate, currency, s1_multiplier, ooh_multiplier, overage_rate, effective_from, proposed_by, proposed_role, accepted_by, source, terms_version)
  VALUES (_id, 1, (a.terms -> 'rate' ->> 'hourly_rate')::numeric, a.terms -> 'rate' ->> 'currency', NULLIF(a.terms -> 'rate' ->> 's1_multiplier', '')::numeric,
          NULLIF(a.terms -> 'rate' ->> 'ooh_multiplier', '')::numeric, NULLIF(a.terms -> 'rate' ->> 'overage_rate', '')::numeric,
          (a.terms -> 'term' ->> 'start_date')::date, (SELECT p.user_id FROM public.sa_applications p WHERE p.id = a.application_id), 'consultant', uid, 'negotiation', a.version)
  RETURNING id INTO rid;
  UPDATE public.sa_agreements SET agreed_at = now(), current_rate_id = rid, start_date = (terms -> 'term' ->> 'start_date')::date,
         end_date = NULLIF(terms -> 'term' ->> 'end_date', '')::date,
         admin_review = CASE WHEN COALESCE((s ->> 'needs_admin_review')::boolean, true) AND first_pair THEN 'pending' ELSE 'not_needed' END
   WHERE id = _id;
  -- Crew: the lead's place and SLA acceptance come from the terms acceptance (+ the SLA box ticked when applying);
  -- every other crew member is invited and must accept the place and the SLA snapshot.
  INSERT INTO public.sa_members (agreement_id, consultant_id, member_role, status, required, capacity_hours_per_week, working_hours, invited_by,
                                 accepted_at, sla_policy_id, sla_version, sla_hash, sla_accepted_at)
  SELECT _id, a.consultant_id, 'lead', 'active', true, NULLIF(q.le ->> 'capacity_hours_per_week', '')::numeric, COALESCE(q.le -> 'working_hours', '{}'::jsonb), a.client_id,
         now(), NULLIF(a.terms -> 'sla' ->> 'policy_id', '')::uuid, NULLIF(a.terms -> 'sla' ->> 'version', '')::int, a.terms -> 'sla' ->> 'hash',
         COALESCE((SELECT p.sla_accepted_at FROM public.sa_applications p WHERE p.id = a.application_id), now())
    FROM (SELECT (SELECT e FROM jsonb_array_elements(COALESCE(a.terms -> 'team', '[]'::jsonb)) e WHERE e ->> 'consultant_id' = a.consultant_id::text LIMIT 1) AS le) q
  ON CONFLICT DO NOTHING;
  INSERT INTO public.sa_member_acceptances (agreement_id, consultant_id, user_id, member_role, terms_version, terms_hash, sla_policy_id, sla_version, sla_hash, sla_summary, typed_name, legal_draft)
  SELECT _id, a.consultant_id, x.user_id, 'lead', a.version, x.content_hash, NULLIF(a.terms -> 'sla' ->> 'policy_id', '')::uuid, NULLIF(a.terms -> 'sla' ->> 'version', '')::int,
         a.terms -> 'sla' ->> 'hash', COALESCE(a.terms -> 'sla' ->> 'summary', ''), x.typed_name, x.legal_draft
    FROM public.sa_acceptances x WHERE x.agreement_id = _id AND x.version = a.version AND x.party = 'consultant';
  FOR te IN SELECT jsonb_array_elements(COALESCE(a.terms -> 'team', '[]'::jsonb)) LOOP
    CONTINUE WHEN te ->> 'consultant_id' = a.consultant_id::text;
    INSERT INTO public.sa_members (agreement_id, consultant_id, member_role, status, required, capacity_hours_per_week, working_hours, backup_for, invited_by)
    VALUES (_id, (te ->> 'consultant_id')::uuid, te ->> 'role', 'invited', COALESCE((te ->> 'required')::boolean, true), NULLIF(te ->> 'capacity_hours_per_week', '')::numeric,
            COALESCE(te -> 'working_hours', '{}'::jsonb), NULLIF(te ->> 'backup_for', '')::uuid, a.client_id)
    ON CONFLICT DO NOTHING;
    PERFORM public.sa_notify_member_invite(_id, (te ->> 'consultant_id')::uuid);
  END LOOP;
  UPDATE public.sa_applications SET status = 'declined', updated_at = now() WHERE agreement_id = _id AND id <> a.application_id AND status IN ('pending', 'shortlisted');
  PERFORM public.sa_set_status(_id, 'agreed', uid, jsonb_build_object('version', a.version, 'rate_record', rid));
  PERFORM public.sa_notify_parties(_id, 'Support agreement agreed: ' || a.name, 'تم الاتفاق على اتفاقية الدعم: ' || a.name,
    'Both parties accepted version ' || a.version || '. It starts when the crew is confirmed: every required member accepted the place and the SLA, the NDA is signed by both sides and the start date has come'
      || CASE WHEN first_pair AND COALESCE((s ->> 'needs_admin_review')::boolean, true) THEN ', after our team has reviewed it.' ELSE '.' END,
    'قبل الطرفان الإصدار ' || a.version || '. تبدأ عند تأكيد الفريق: قبول كل عضو مطلوب لمكانه ولاتفاقية مستوى الخدمة، وتوقيع اتفاقية عدم الإفصاح من الطرفين، وحلول تاريخ البدء.', true, 'agreed:' || _id);
  IF first_pair AND COALESCE((s ->> 'needs_admin_review')::boolean, true) THEN
    PERFORM public.sa_notify_admins(_id, 'Support agreement to review', a.name || ' needs an admin review before it starts.', 'review:' || _id);
  END IF;
  PERFORM public.sa_try_activate(_id);
  RETURN jsonb_build_object('agreed', true, 'admin_review', first_pair AND COALESCE((s ->> 'needs_admin_review')::boolean, true));
END $$;

CREATE OR REPLACE FUNCTION public.sa_notify_member_invite(_id uuid, _consultant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm text := (SELECT a.name FROM public.sa_agreements a WHERE a.id = _id);
BEGIN
  PERFORM public.sa_notify(_id, public.sa_user_of(_consultant), 'Join a support crew: ' || nm, 'الانضمام إلى فريق دعم: ' || nm,
    'A client invites you to the crew of a long-term support agreement at the agreed rate. Review your role, capacity and the SLA, then accept or decline.',
    'يدعوك عميل إلى فريق اتفاقية دعم طويلة الأمد بالسعر المتفق عليه. راجع دورك وساعاتك واتفاقية مستوى الخدمة ثم اقبل أو اعتذر.',
    'consultant', true, 'member:' || _id || ':' || _consultant || ':' || extract(epoch FROM now())::bigint / 86400);
END $$;

-- Agreed -> Active only when the team confirmation checklist is complete (sa_confirmation). From that moment the
-- agreement's SLA snapshot applies to new tickets under the agreement ("SLA starts when the crew is confirmed").
CREATE OR REPLACE FUNCTION public.sa_try_activate(_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.sa_agreements;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF a.status <> 'agreed' OR NOT COALESCE((public.sa_confirmation(_id) ->> 'ready')::boolean, false) THEN RETURN false; END IF;
  UPDATE public.sa_agreements SET started_at = now(), last_activity_at = now() WHERE id = _id;
  PERFORM public.sa_set_status(_id, 'active', NULL);
  PERFORM public.sa_notify_parties(_id, 'Support agreement active: ' || a.name, 'اتفاقية الدعم نشطة: ' || a.name,
    'The crew is confirmed. From today new tickets under this agreement go directly to the committed consultant at the agreed rate, and the agreement SLA applies.',
    'تم تأكيد الفريق. من اليوم تذهب التذاكر الجديدة ضمن هذه الاتفاقية مباشرة إلى الاستشاري الملتزم بالسعر المتفق عليه، وتسري اتفاقية مستوى الخدمة الخاصة بالاتفاقية.', true, 'active:' || _id);
  RETURN true;
END $$;

-- ------------------------------------------------------------------------------------------------ rate changes (annual review)
CREATE OR REPLACE FUNCTION public.sa_propose_rate_change(_id uuid, _rate numeric, _s1 numeric, _ooh numeric, _overage numeric, _effective date, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; r text := public.sa_role(_id, uid); probs text[]; new_id uuid;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF r NOT IN ('client', 'lead') OR a.status NOT IN ('agreed', 'active', 'suspended', 'renewal_due') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF _effective IS NULL OR _effective <= current_date THEN RAISE EXCEPTION 'sa_not_retroactive: the effective date must be in the future' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_text_ok(_reason) OR char_length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'sa_reason_required' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_rate_ok('sa_ratechange:' || uid, 5, 86400) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  probs := public.sa_rate_problems(_rate, _s1, _ooh, _overage, public.sa_modules(a));
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_rate_out_of_bounds: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sa_rate_changes (agreement_id, proposed_by, proposed_role, hourly_rate, s1_multiplier, ooh_multiplier, overage_rate, effective_from, reason)
  VALUES (_id, uid, public.sa_party(r), round(_rate, 2), _s1, _ooh, _overage, _effective, left(_reason, 500)) RETURNING sa_rate_changes.id INTO new_id;
  PERFORM public.sa_event(_id, 'rate_change_proposed', uid, jsonb_build_object('effective_from', _effective));
  PERFORM public.sa_audit_log(uid, 'rate_change_proposed', _id, jsonb_build_object('rate', _rate, 'effective_from', _effective));
  PERFORM public.sa_notify_parties(_id, 'Rate change proposed: ' || a.name, 'اقتراح تغيير السعر: ' || a.name,
    'A new hourly rate from ' || _effective || ' was proposed. The other party must approve it.', 'اقتُرح سعر جديد اعتباراً من ' || _effective || '. يجب أن يوافق الطرف الآخر.', true, 'ratechange:' || new_id);
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.sa_decide_rate_change(_change uuid, _accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); c public.sa_rate_changes; a public.sa_agreements; r text; rid uuid; prev uuid;
BEGIN
  SELECT * INTO c FROM public.sa_rate_changes WHERE id = _change FOR UPDATE;
  IF c.id IS NULL OR c.status <> 'pending' THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  r := public.sa_role(c.agreement_id, uid);
  IF r NOT IN ('client', 'lead') OR public.sa_party(r) = c.proposed_role THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF _accept AND c.effective_from <= current_date THEN RAISE EXCEPTION 'sa_not_retroactive: propose a new effective date' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = c.agreement_id;
  IF _accept THEN
    SELECT id INTO prev FROM public.sa_rate_records WHERE agreement_id = a.id ORDER BY seq DESC LIMIT 1;
    INSERT INTO public.sa_rate_records (agreement_id, seq, hourly_rate, currency, s1_multiplier, ooh_multiplier, overage_rate, effective_from, proposed_by, proposed_role, accepted_by, source, previous_id)
    VALUES (a.id, (SELECT COALESCE(max(seq), 0) + 1 FROM public.sa_rate_records WHERE agreement_id = a.id), c.hourly_rate, a.terms -> 'rate' ->> 'currency',
            c.s1_multiplier, c.ooh_multiplier, c.overage_rate, c.effective_from, c.proposed_by, c.proposed_role, uid, 'rate_change', prev)
    RETURNING id INTO rid;
  END IF;
  UPDATE public.sa_rate_changes SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END, decided_by = uid, decided_at = now(), rate_record_id = rid WHERE id = _change;
  PERFORM public.sa_event(a.id, CASE WHEN _accept THEN 'rate_change_accepted' ELSE 'rate_change_declined' END, uid, jsonb_build_object('effective_from', c.effective_from));
  PERFORM public.sa_audit_log(uid, CASE WHEN _accept THEN 'rate_change_accepted' ELSE 'rate_change_declined' END, a.id, jsonb_build_object('change', _change));
END $$;

-- ------------------------------------------------------------------------------------------------ lifecycle actions
CREATE OR REPLACE FUNCTION public.sa_request_termination(_id uuid, _reason text)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; r text := public.sa_role(_id, uid); e date; s jsonb := public.sa_settings();
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF r NOT IN ('client', 'lead', 'admin') OR a.status NOT IN ('agreed', 'active', 'suspended', 'renewal_due') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF a.termination_end IS NOT NULL THEN RAISE EXCEPTION 'sa_already_terminating' USING ERRCODE = '55000'; END IF;
  IF char_length(btrim(COALESCE(_reason, ''))) < 10 OR NOT public.sa_text_ok(_reason) THEN RAISE EXCEPTION 'sa_reason_required' USING ERRCODE = '22023'; END IF;
  e := CASE WHEN a.status = 'agreed' THEN current_date ELSE LEAST(current_date + COALESCE((a.terms -> 'term' ->> 'notice_days')::int, 30), COALESCE(a.end_date, 'infinity'::date)) END;
  UPDATE public.sa_agreements SET termination_requested_by = CASE WHEN r = 'lead' THEN 'consultant' ELSE r END, termination_reason = left(_reason, 1000),
         termination_requested_at = now(), termination_end = e, handover_until = e + COALESCE((s ->> 'handover_days')::int, 14) WHERE id = _id;
  PERFORM public.sa_event(_id, 'termination_requested', uid, jsonb_build_object('end', e, 'by', CASE WHEN r = 'lead' THEN 'consultant' ELSE r END));
  PERFORM public.sa_audit_log(uid, 'terminate', _id, jsonb_build_object('end', e, 'reason', left(_reason, 300)));
  IF a.status = 'agreed' THEN PERFORM public.sa_set_status(_id, 'terminated', uid, jsonb_build_object('before_start', true)); END IF;
  PERFORM public.sa_notify_parties(_id, 'Support agreement ending: ' || a.name, 'انتهاء اتفاقية الدعم: ' || a.name,
    'Termination was requested. The last day is ' || e || ' (notice period). A handover note follows.', 'طُلب إنهاء الاتفاقية. آخر يوم هو ' || e || ' (فترة الإشعار). ستتبعها ملاحظة تسليم.', true, 'terminate:' || _id);
  RETURN e;
END $$;

CREATE OR REPLACE FUNCTION public.sa_handover_note(_id uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF public.sa_role(_id, uid) NOT IN ('lead', 'admin') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_text_ok(_note) OR char_length(btrim(COALESCE(_note, ''))) < 10 THEN RAISE EXCEPTION 'sa_note_required' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_secret_ok(_note) THEN RAISE EXCEPTION 'sa_secret_details' USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_agreements SET handover_note = left(_note, 4000) WHERE id = _id AND termination_end IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'sa_not_terminating' USING ERRCODE = '55000'; END IF;
  PERFORM public.sa_event(_id, 'handover_note', uid);
END $$;

CREATE OR REPLACE FUNCTION public.sa_suspend(_id uuid, _until date, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF public.sa_role(_id, uid) NOT IN ('client', 'lead', 'admin') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF _until IS NULL OR _until <= current_date OR _until > current_date + 120 THEN RAISE EXCEPTION 'sa_bad_date' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_text_ok(_reason) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_agreements SET suspended_until = _until WHERE id = _id;
  PERFORM public.sa_set_status(_id, 'suspended', uid, jsonb_build_object('until', _until, 'reason', left(_reason, 300)));
  PERFORM public.sa_notify_parties(_id, 'Support agreement paused: ' || a.name, 'إيقاف مؤقت لاتفاقية الدعم: ' || a.name,
    'Paused until ' || _until || '.', 'متوقفة حتى ' || _until || '.', true, 'suspend:' || _id || ':' || _until);
END $$;

CREATE OR REPLACE FUNCTION public.sa_resume(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF public.sa_role(_id, uid) NOT IN ('client', 'lead', 'admin') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.sa_agreements SET suspended_until = NULL WHERE id = _id;
  PERFORM public.sa_set_status(_id, 'active', uid);
END $$;

-- Auto-renew needs the explicit consent of BOTH parties; either can withdraw it before the end date.
CREATE OR REPLACE FUNCTION public.sa_set_auto_renew(_id uuid, _on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.sa_role(_id, uid); a public.sa_agreements;
BEGIN
  IF r NOT IN ('client', 'lead') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF r = 'client' THEN UPDATE public.sa_agreements SET auto_renew_client_at = CASE WHEN _on THEN now() END WHERE id = _id RETURNING * INTO a;
  ELSE UPDATE public.sa_agreements SET auto_renew_consultant_at = CASE WHEN _on THEN now() END WHERE id = _id RETURNING * INTO a; END IF;
  PERFORM public.sa_event(_id, CASE WHEN _on THEN 'auto_renew_on' ELSE 'auto_renew_off' END, uid);
  RETURN jsonb_build_object('client', a.auto_renew_client_at IS NOT NULL, 'consultant', a.auto_renew_consultant_at IS NOT NULL);
END $$;

-- Crew after the agreement: the client invites more members (role, capacity, working hours, backup cover, required),
-- changes their details or removes them; members accept the place + SLA snapshot or decline; a member may leave.
DROP FUNCTION IF EXISTS public.sa_invite_member(uuid, uuid);
CREATE OR REPLACE FUNCTION public.sa_invite_member(_id uuid, _consultant uuid, _role text, _capacity numeric, _working_hours jsonb, _backup_for uuid, _required boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; probs text[]; entry jsonb; team jsonb;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF public.sa_role(_id, uid) <> 'client' OR a.status NOT IN ('agreed', 'active', 'renewal_due', 'suspended') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_rate_ok('sa_crew:' || uid, 30, 86400) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  IF _consultant = a.consultant_id OR COALESCE(_role, '') = 'lead'
     OR (SELECT count(*) FROM public.sa_members m WHERE m.agreement_id = _id AND m.status IN ('invited', 'active', 'declined')) >= COALESCE((public.sa_settings() ->> 'crew_max')::int, 6) THEN
    RAISE EXCEPTION 'sa_team_full' USING ERRCODE = '55000';
  END IF;
  entry := jsonb_strip_nulls(jsonb_build_object('consultant_id', _consultant, 'role', _role, 'capacity_hours_per_week', _capacity,
             'working_hours', COALESCE(_working_hours, '{}'::jsonb), 'backup_for', _backup_for));
  SELECT COALESCE(jsonb_agg(jsonb_build_object('consultant_id', m.consultant_id, 'role', m.member_role)), '[]'::jsonb) INTO team
    FROM public.sa_members m WHERE m.agreement_id = _id AND m.status IN ('invited', 'active', 'declined');
  probs := public.sa_crew_problems(a.tenant_id, a.client_id, team || jsonb_build_array(entry), a.consultant_id);
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_terms_invalid: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sa_members (agreement_id, consultant_id, member_role, status, required, capacity_hours_per_week, working_hours, backup_for, invited_by)
  VALUES (_id, _consultant, _role, 'invited', COALESCE(_required, true), _capacity, COALESCE(_working_hours, '{}'::jsonb), _backup_for, uid);
  PERFORM public.sa_event(_id, 'member_invited', uid, jsonb_build_object('consultant', _consultant, 'role', _role, 'required', COALESCE(_required, true)));
  PERFORM public.sa_audit_log(uid, 'member_invited', _id, jsonb_build_object('consultant', _consultant, 'role', _role));
  PERFORM public.sa_notify_member_invite(_id, _consultant);
END $$;

CREATE OR REPLACE FUNCTION public.sa_update_member(_id uuid, _consultant uuid, _role text, _capacity numeric, _working_hours jsonb, _backup_for uuid, _required boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; m public.sa_members; probs text[]; team jsonb;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF public.sa_role(_id, uid) <> 'client' OR a.status NOT IN ('agreed', 'active', 'renewal_due', 'suspended') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO m FROM public.sa_members x WHERE x.agreement_id = _id AND x.consultant_id = _consultant AND x.status IN ('invited', 'active', 'declined') FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  IF m.member_role = 'lead' THEN _role := 'lead'; _required := true; ELSIF COALESCE(_role, '') = 'lead' THEN RAISE EXCEPTION 'sa_forbidden: the lead changes through a replacement' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(CASE WHEN x.consultant_id = _consultant
           THEN jsonb_build_object('consultant_id', x.consultant_id, 'role', COALESCE(_role, x.member_role), 'capacity_hours_per_week', _capacity, 'working_hours', COALESCE(_working_hours, '{}'::jsonb), 'backup_for', _backup_for)
           ELSE jsonb_build_object('consultant_id', x.consultant_id, 'role', x.member_role) END)), '[]'::jsonb) INTO team
    FROM public.sa_members x WHERE x.agreement_id = _id AND x.status IN ('invited', 'active', 'declined');
  probs := public.sa_crew_problems(a.tenant_id, a.client_id, team, a.consultant_id);
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_terms_invalid: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_members SET member_role = COALESCE(_role, member_role), capacity_hours_per_week = _capacity, working_hours = COALESCE(_working_hours, '{}'::jsonb),
         backup_for = _backup_for, required = COALESCE(_required, required) WHERE id = m.id;
  PERFORM public.sa_event(_id, 'member_updated', uid, jsonb_build_object('consultant', _consultant));
  PERFORM public.sa_try_activate(_id);
END $$;

CREATE OR REPLACE FUNCTION public.sa_remove_member(_id uuid, _consultant uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.sa_role(_id, uid); self boolean := public.sa_consultant_of(uid) = _consultant; a public.sa_agreements;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF NOT (r = 'client' OR (r = 'team' AND self)) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF _consultant = a.consultant_id THEN RAISE EXCEPTION 'sa_forbidden: the lead leaves through termination or a replacement' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(COALESCE(_reason, ''))) < 5 OR NOT public.sa_text_ok(_reason) THEN RAISE EXCEPTION 'sa_reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_members SET status = 'ended', ended_at = now(), end_reason = left(_reason, 500)
   WHERE agreement_id = _id AND consultant_id = _consultant AND status IN ('invited', 'active', 'declined');
  IF NOT FOUND THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.sa_event(_id, CASE WHEN self THEN 'member_left' ELSE 'member_removed' END, uid, jsonb_build_object('consultant', _consultant));
  PERFORM public.sa_audit_log(uid, 'member_removed', _id, jsonb_build_object('consultant', _consultant, 'reason', left(_reason, 300)));
  IF NOT self THEN
    PERFORM public.sa_notify(_id, public.sa_user_of(_consultant), 'Crew place ended: ' || a.name, 'انتهاء مكانك في الفريق: ' || a.name,
      'The client ended your place in this support crew.', 'أنهى العميل مكانك في فريق الدعم هذا.', 'consultant', true, 'removed:' || _id || ':' || _consultant || ':' || now());
  END IF;
  PERFORM public.sa_try_activate(_id);
END $$;

-- A crew member accepts the place AND the agreement's SLA snapshot (checkbox + typed name), or declines.
DROP FUNCTION IF EXISTS public.sa_member_respond(uuid, boolean);
CREATE OR REPLACE FUNCTION public.sa_member_respond(_id uuid, _accept boolean, _sla_accepted boolean, _typed_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); cid uuid := public.sa_consultant_of(uid); a public.sa_agreements; m public.sa_members; s jsonb := public.sa_settings();
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  SELECT * INTO m FROM public.sa_members x WHERE x.agreement_id = _id AND x.consultant_id = cid AND x.status = 'invited' FOR UPDATE;
  IF m.id IS NULL OR a.status NOT IN ('agreed', 'active', 'renewal_due', 'suspended') THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _accept THEN
    IF _sla_accepted IS NOT TRUE THEN RAISE EXCEPTION 'sa_sla_acceptance_required' USING ERRCODE = '22023'; END IF;
    IF char_length(btrim(COALESCE(_typed_name, ''))) < 2 OR NOT public.sa_text_ok(_typed_name) THEN RAISE EXCEPTION 'sa_name_required' USING ERRCODE = '22023'; END IF;
    UPDATE public.sa_members SET status = 'active', accepted_at = now(), sla_policy_id = NULLIF(a.terms -> 'sla' ->> 'policy_id', '')::uuid,
           sla_version = NULLIF(a.terms -> 'sla' ->> 'version', '')::int, sla_hash = a.terms -> 'sla' ->> 'hash', sla_accepted_at = now() WHERE id = m.id;
    INSERT INTO public.sa_member_acceptances (agreement_id, consultant_id, user_id, member_role, terms_version, terms_hash, sla_policy_id, sla_version, sla_hash, sla_summary, typed_name, legal_draft)
    VALUES (_id, cid, uid, m.member_role, a.version, (SELECT v.content_hash FROM public.sa_versions v WHERE v.agreement_id = _id AND v.version = a.version),
            NULLIF(a.terms -> 'sla' ->> 'policy_id', '')::uuid, NULLIF(a.terms -> 'sla' ->> 'version', '')::int, a.terms -> 'sla' ->> 'hash',
            COALESCE(a.terms -> 'sla' ->> 'summary', ''), left(btrim(_typed_name), 120), COALESCE((s ->> 'draft_legal_flag')::boolean, true));
  ELSE
    UPDATE public.sa_members SET status = 'declined' WHERE id = m.id;
  END IF;
  PERFORM public.sa_event(_id, CASE WHEN _accept THEN 'member_joined' ELSE 'member_declined' END, uid, jsonb_build_object('role', m.member_role));
  PERFORM public.sa_audit_log(uid, CASE WHEN _accept THEN 'member_accept' ELSE 'member_decline' END, _id, jsonb_build_object('role', m.member_role));
  PERFORM public.sa_notify(_id, a.client_id, CASE WHEN _accept THEN 'Crew member accepted: ' ELSE 'Crew member declined: ' END || a.name,
    CASE WHEN _accept THEN 'قبل عضو في الفريق: ' ELSE 'اعتذر عضو في الفريق: ' END || a.name,
    CASE WHEN _accept THEN 'A crew member accepted the place and the SLA.' ELSE 'A crew member declined. Invite someone else or mark the place as optional.' END,
    CASE WHEN _accept THEN 'قبل عضو في الفريق مكانه واتفاقية مستوى الخدمة.' ELSE 'اعتذر عضو في الفريق. ادعُ شخصاً آخر أو اجعل المكان اختيارياً.' END,
    'client', NOT _accept, 'member_resp:' || m.id || ':' || _accept);
  RETURN jsonb_build_object('activated', public.sa_try_activate(_id));
END $$;

-- Replacing the lead mid-term: client asks -> admin approves -> new consultant accepts; the rate is kept.
CREATE OR REPLACE FUNCTION public.sa_request_replacement(_id uuid, _to uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; new_id uuid;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF public.sa_role(_id, uid) <> 'client' OR a.status NOT IN ('active', 'suspended', 'renewal_due') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_text_ok(_reason) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sa_replacements (agreement_id, from_consultant, to_consultant, reason, requested_by) VALUES (_id, a.consultant_id, _to, left(_reason, 1000), uid)
  RETURNING sa_replacements.id INTO new_id;
  PERFORM public.sa_event(_id, 'replacement_requested', uid);
  PERFORM public.sa_notify_admins(_id, 'Consultant replacement requested', a.name || ': the client asks to replace the lead consultant.', 'replace:' || new_id);
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.sa_admin_decide_replacement(_replacement uuid, _approve boolean, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); x public.sa_replacements;
BEGIN
  IF NOT public.sa_is_admin(uid) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO x FROM public.sa_replacements WHERE id = _replacement AND status = 'pending_admin' FOR UPDATE;
  IF x.id IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.sa_replacements SET status = CASE WHEN _approve THEN 'pending_consultant' ELSE 'declined' END, admin_by = uid, admin_at = now() WHERE id = _replacement;
  PERFORM public.sa_audit_log(uid, 'replacement_admin', x.agreement_id, jsonb_build_object('approve', _approve, 'note', left(_note, 300)));
  IF _approve THEN
    PERFORM public.sa_notify(x.agreement_id, public.sa_user_of(x.to_consultant), 'Take over a support agreement', 'تولّي اتفاقية دعم',
      'You are asked to take over a support agreement at the agreed rate.', 'يُطلب منك تولّي اتفاقية دعم بالسعر المتفق عليه.', 'consultant', true, 'takeover:' || x.id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sa_replacement_accept(_replacement uuid, _accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); x public.sa_replacements;
BEGIN
  SELECT * INTO x FROM public.sa_replacements WHERE id = _replacement AND status = 'pending_consultant' FOR UPDATE;
  IF x.id IS NULL OR x.to_consultant <> public.sa_consultant_of(uid) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.sa_replacements SET status = CASE WHEN _accept THEN 'done' ELSE 'declined' END, done_at = now() WHERE id = _replacement;
  IF _accept THEN
    UPDATE public.sa_members SET status = 'ended', ended_at = now() WHERE agreement_id = x.agreement_id AND consultant_id = x.from_consultant AND status = 'active';
    UPDATE public.sa_members m SET member_role = 'lead', status = 'active', required = true, accepted_at = COALESCE(m.accepted_at, now()), sla_accepted_at = now(),
           sla_policy_id = NULLIF(ag.terms -> 'sla' ->> 'policy_id', '')::uuid, sla_version = NULLIF(ag.terms -> 'sla' ->> 'version', '')::int, sla_hash = ag.terms -> 'sla' ->> 'hash'
      FROM public.sa_agreements ag
     WHERE ag.id = x.agreement_id AND m.agreement_id = x.agreement_id AND m.consultant_id = x.to_consultant AND m.status IN ('invited', 'active', 'declined');
    IF NOT FOUND THEN
      INSERT INTO public.sa_members (agreement_id, consultant_id, member_role, status, accepted_at, sla_accepted_at, sla_policy_id, sla_version, sla_hash)
      SELECT x.agreement_id, x.to_consultant, 'lead', 'active', now(), now(), NULLIF(ag.terms -> 'sla' ->> 'policy_id', '')::uuid, NULLIF(ag.terms -> 'sla' ->> 'version', '')::int, ag.terms -> 'sla' ->> 'hash'
        FROM public.sa_agreements ag WHERE ag.id = x.agreement_id;
    END IF;
    UPDATE public.sa_agreements SET consultant_id = x.to_consultant WHERE id = x.agreement_id;
    PERFORM public.sa_event(x.agreement_id, 'lead_replaced', uid);
    PERFORM public.sa_audit_log(uid, 'lead_replaced', x.agreement_id, jsonb_build_object('from', x.from_consultant, 'to', x.to_consultant));
  END IF;
END $$;

-- Q&A between the client and one applicant / the parties (contact-details filter M60).
CREATE OR REPLACE FUNCTION public.sa_post_message(_id uuid, _consultant uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.sa_role(_id, uid); cid uuid; new_id uuid; a public.sa_agreements;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF r IN ('candidate', 'applicant', 'lead', 'team') THEN cid := public.sa_consultant_of(uid);
  ELSIF r = 'client' THEN cid := _consultant;
  ELSE RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF cid IS NULL THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_text_ok(_body) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_secret_ok(_body) THEN RAISE EXCEPTION 'sa_secret_details' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_rate_ok('sa_msg:' || uid, 60, 3600) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  INSERT INTO public.sa_messages (agreement_id, consultant_id, sender_id, sender_role, body)
  VALUES (_id, cid, uid, CASE WHEN r = 'client' THEN 'client' ELSE 'consultant' END, left(btrim(_body), 2000)) RETURNING sa_messages.id INTO new_id;
  IF r = 'client' THEN
    PERFORM public.sa_notify(_id, public.sa_user_of(cid), 'New message: ' || a.name, 'رسالة جديدة: ' || a.name, 'The client replied about the support agreement.', 'ردّ العميل بخصوص اتفاقية الدعم.', 'consultant', false, 'msg:' || new_id);
  ELSE
    PERFORM public.sa_notify(_id, a.client_id, 'New question: ' || a.name, 'سؤال جديد: ' || a.name, 'A consultant wrote about your support agreement.', 'كتب استشاري بخصوص اتفاقية الدعم.', 'client', false, 'msg:' || new_id);
  END IF;
  RETURN new_id;
END $$;

-- ------------------------------------------------------------------------------------------------ tickets under an agreement
CREATE OR REPLACE FUNCTION public.sa_ticket_live_agreement(_ticket uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT st.agreement_id FROM public.sa_tickets st JOIN public.sa_agreements a ON a.id = st.agreement_id WHERE st.ticket_id = _ticket LIMIT 1
$$;

-- SLA hook used by sla_effective_policy (docs/sql/sla-policies.sql): the policy version attached to the agreement,
-- ONLY while the agreement is live (Active / Renewal due = crew confirmed). Before that, or after it ended, tickets
-- use the normal flow (client policy or platform default SLA).
CREATE OR REPLACE FUNCTION public.sa_ticket_sla(_ticket uuid)
RETURNS TABLE (policy_id uuid, version integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NULLIF(a.terms -> 'sla' ->> 'policy_id', '')::uuid, NULLIF(a.terms -> 'sla' ->> 'version', '')::int
    FROM public.sa_tickets st JOIN public.sa_agreements a ON a.id = st.agreement_id
   WHERE st.ticket_id = _ticket AND NULLIF(a.terms -> 'sla' ->> 'policy_id', '') IS NOT NULL
     AND a.status IN ('active', 'renewal_due') AND a.started_at IS NOT NULL LIMIT 1
$$;

-- True when the ticket's current SLA snapshot is the agreement's SLA version (header chip "Agreement SLA").
CREATE OR REPLACE FUNCTION public.sa_ticket_uses_agreement_sla(_ticket uuid, _policy uuid, _version integer)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  IF _policy IS NULL OR to_regclass('public.sla_ticket_snapshots') IS NULL THEN RETURN false; END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.sla_ticket_snapshots s WHERE s.ticket_id = $1 AND s.superseded_at IS NULL AND s.policy_id = $2 AND s.policy_version = $3)'
    INTO ok USING _ticket, _policy, _version;
  RETURN COALESCE(ok, false);
END $$;

-- The lead accepted the agreement's SLA snapshot when the crew was confirmed: on a ticket under the agreement whose
-- SLA snapshot is exactly that version, the lead's per-ticket SLA acceptance (sla_acceptances) is recorded for him,
-- so the assignment request is not blocked by the SLA acceptance rule. Any other SLA still needs the normal box.
CREATE OR REPLACE FUNCTION public.sa_record_crew_sla(_ticket uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.sa_agreements; m public.sa_members; pol uuid; ver int;
BEGIN
  IF to_regclass('public.sla_acceptances') IS NULL THEN RETURN; END IF;
  SELECT ag.* INTO a FROM public.sa_tickets st JOIN public.sa_agreements ag ON ag.id = st.agreement_id WHERE st.ticket_id = _ticket;
  IF a.id IS NULL OR a.status NOT IN ('active', 'renewal_due') THEN RETURN; END IF;
  pol := NULLIF(a.terms -> 'sla' ->> 'policy_id', '')::uuid; ver := NULLIF(a.terms -> 'sla' ->> 'version', '')::int;
  IF NOT public.sa_ticket_uses_agreement_sla(_ticket, pol, ver) THEN RETURN; END IF;
  SELECT * INTO m FROM public.sa_members x WHERE x.agreement_id = a.id AND x.consultant_id = a.consultant_id AND x.status = 'active' AND x.sla_accepted_at IS NOT NULL
     AND x.sla_policy_id IS NOT DISTINCT FROM pol AND x.sla_version IS NOT DISTINCT FROM ver;
  IF m.id IS NULL THEN RETURN; END IF;
  EXECUTE $q$INSERT INTO public.sla_acceptances (ticket_id, consultant_id, user_id, snapshot_id, policy_id, policy_version, summary, context)
             SELECT s.ticket_id, $2, $3, s.id, s.policy_id, s.policy_version, left('Accepted with support agreement ' || $4 || ' on ' || to_char($5, 'YYYY-MM-DD'), 500), 'assignment'
               FROM public.sla_ticket_snapshots s WHERE s.ticket_id = $1 AND s.superseded_at IS NULL
             ON CONFLICT (ticket_id, consultant_id, snapshot_id) DO NOTHING$q$
    USING _ticket, m.consultant_id, public.sa_user_of(m.consultant_id), a.reference, m.sla_accepted_at;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Agreement SLA acceptance not recorded for ticket %: %', _ticket, SQLERRM;
END $$;

-- Links a ticket to a live agreement of the same client / company whose scope covers the module: approved agreement
-- rate (S1 multiplier for critical tickets) and a direct assignment request to the lead consultant (no bidding).
-- Returns false (and changes nothing) when the agreement does not apply. Never raises.
CREATE OR REPLACE FUNCTION public.sa_link_ticket(_ticket uuid, _agreement uuid, _actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; a public.sa_agreements; rr public.sa_rate_records; rate numeric;
BEGIN
  IF NOT public.sa_enabled() OR _agreement IS NULL THEN RETURN false; END IF;
  SELECT tk.id, tk.client_id, tk.tenant_id, tk.sap_module, tk.sap_modules, tk.critical_response, tk.urgency::text AS urgency INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  IF t.id IS NULL OR EXISTS (SELECT 1 FROM public.sa_tickets x WHERE x.ticket_id = _ticket) THEN RETURN false; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = _agreement;
  IF a.id IS NULL OR a.status NOT IN ('active', 'renewal_due') OR a.termination_end < current_date THEN RETURN false; END IF;
  IF NOT ((a.tenant_id IS NOT NULL AND a.tenant_id = t.tenant_id) OR (a.client_id = t.client_id)) THEN RETURN false; END IF;
  IF NOT (t.sap_module = ANY (public.sa_modules(a)) OR COALESCE(t.sap_modules, '{}') && public.sa_modules(a)) THEN RETURN false; END IF;
  INSERT INTO public.sa_tickets (ticket_id, agreement_id) VALUES (_ticket, _agreement);
  rr := public.sa_rate_on(_agreement, current_date);
  IF rr.id IS NOT NULL THEN
    rate := round(rr.hourly_rate * CASE WHEN COALESCE(t.critical_response, false) OR t.urgency = 'critical' THEN COALESCE(rr.s1_multiplier, 1) ELSE 1 END, 2);
    UPDATE public.ticket_rates SET status = 'replaced' WHERE ticket_id = _ticket AND consultant_id = a.consultant_id AND status IN ('proposed', 'approved');
    INSERT INTO public.ticket_rates (ticket_id, consultant_id, hourly_rate, currency, status, source, proposed_by, decided_by, decided_at, decision_note, base_rate, surcharge_percent)
    VALUES (_ticket, a.consultant_id, rate, rr.currency, 'approved', 'agreement', public.sa_user_of(a.consultant_id), t.client_id, now(),
            left('Support agreement "' || a.name || '" (' || a.reference || ', rate record ' || rr.seq || ')', 500),
            CASE WHEN rate <> rr.hourly_rate THEN rr.hourly_rate END, CASE WHEN rate <> rr.hourly_rate THEN round((rate / rr.hourly_rate - 1) * 100, 2) END);
  END IF;
  BEGIN
    INSERT INTO public.ticket_match_requests (ticket_id, consultant_id, sent_by, status, message)
    VALUES (_ticket, a.consultant_id, t.client_id, 'pending', left('Support agreement: ' || a.name || ' (' || a.reference || ')', 500));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Agreement request to the lead consultant skipped: %', SQLERRM;
  END;
  UPDATE public.sa_agreements SET last_activity_at = now() WHERE id = _agreement;
  PERFORM public.sa_event(_agreement, 'ticket_linked', _actor, jsonb_build_object('ticket', _ticket));
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Support agreement link skipped for ticket %: %', _ticket, SQLERRM;
  RETURN false;
END $$;

-- Trusted (server) inserts may pass ticket_context.support_agreement_id; the browser cannot (guard_ticket_context
-- accepts only matching keys) and uses sa_attach_ticket right after creating the ticket.
CREATE OR REPLACE FUNCTION public.sa_on_ticket_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE aid uuid;
BEGIN
  BEGIN
    aid := NULLIF(NEW.ticket_context ->> 'support_agreement_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
  IF aid IS NOT NULL THEN PERFORM public.sa_link_ticket(NEW.id, aid, NEW.client_id); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sa_ticket_link ON public.tickets;   -- runs before sla_ticket_insert (name order), so the SLA hook sees the link
CREATE TRIGGER sa_ticket_link AFTER INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.sa_on_ticket_insert();
-- ...and this one after it (name order 'sm' > 'sla'), once the ticket has its SLA snapshot.
CREATE OR REPLACE FUNCTION public.sa_on_ticket_insert_sla()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sa_tickets st WHERE st.ticket_id = NEW.id) THEN PERFORM public.sa_record_crew_sla(NEW.id); END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sm_sa_crew_sla ON public.tickets;
CREATE TRIGGER sm_sa_crew_sla AFTER INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.sa_on_ticket_insert_sla();

-- New-request form switch "Use my support agreement": the ticket's own client (or a company member who may use the
-- agreement) attaches a just-created, still unassigned ticket. The SLA snapshot is re-applied with the agreement's policy.
CREATE OR REPLACE FUNCTION public.sa_attach_ticket(_ticket uuid, _agreement uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); t record; ok boolean; pol uuid; ver int;
BEGIN
  SELECT tk.id, tk.client_id, tk.consultant_id, tk.created_at INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  IF t.id IS NULL OR t.client_id <> uid OR public.sa_role(_agreement, uid) NOT IN ('client', 'client_member') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF t.consultant_id IS NOT NULL OR t.created_at < now() - interval '30 minutes' THEN RAISE EXCEPTION 'sa_too_late: attach right after creating the ticket' USING ERRCODE = '55000'; END IF;
  ok := public.sa_link_ticket(_ticket, _agreement, uid);
  IF ok AND to_regprocedure('public.sla_apply_snapshot(uuid,text,uuid,text,text,text,uuid,integer,jsonb)') IS NOT NULL THEN
    SELECT x.policy_id, x.version INTO pol, ver FROM public.sa_ticket_sla(_ticket) x;
    IF pol IS NOT NULL AND EXISTS (SELECT 1 FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL AND (s.policy_id IS DISTINCT FROM pol OR s.policy_version IS DISTINCT FROM ver)) THEN
      EXECUTE 'SELECT public.sla_apply_snapshot($1, ''new_policy'', $2, ''fresh'', NULL, ''Support agreement SLA'', $3, $4)' USING _ticket, uid, pol, ver;
    END IF;
    PERFORM public.sa_record_crew_sla(_ticket);
  END IF;
  RETURN jsonb_build_object('linked', ok, 'agreement_sla', ok AND pol IS NOT NULL);
END $$;

-- Timesheet activity keeps the agreement "active" for the bypass check.
CREATE OR REPLACE FUNCTION public.sa_on_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.sa_agreements a SET last_activity_at = now() FROM public.sa_tickets st WHERE st.ticket_id = NEW.ticket_id AND a.id = st.agreement_id;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sa_activity ON public.ticket_work_logs;
CREATE TRIGGER sa_activity AFTER INSERT ON public.ticket_work_logs FOR EACH ROW EXECUTE FUNCTION public.sa_on_activity();
DROP TRIGGER IF EXISTS sa_activity ON public.ticket_timesheet_submissions;
CREATE TRIGGER sa_activity AFTER INSERT OR UPDATE OF status ON public.ticket_timesheet_submissions FOR EACH ROW EXECUTE FUNCTION public.sa_on_activity();

-- Agreements a client may use on the new-request form ("Use my support agreement").
CREATE OR REPLACE FUNCTION public.sa_usable(_tenant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'reference', a.reference, 'modules', to_jsonb(public.sa_modules(a)),
                                              'sla_name', a.terms -> 'sla' ->> 'name')), '[]'::jsonb)
    FROM public.sa_agreements a
   WHERE public.sa_enabled() AND a.status IN ('active', 'renewal_due') AND (a.termination_end IS NULL OR a.termination_end >= current_date)
     AND ((_tenant IS NOT NULL AND a.tenant_id = _tenant AND public.sa_role(a.id, auth.uid()) IN ('client', 'client_member'))
       OR (_tenant IS NULL AND a.client_id = auth.uid()))
$$;

-- "Agreement: <name>" tags for lists and headers (parties only), with the reference and whether the ticket runs on the
-- agreement's SLA snapshot ("Agreement SLA") or on the normal flow ("Platform SLA" / company policy).
CREATE OR REPLACE FUNCTION public.sa_ticket_tags(_tickets uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ticket_id', st.ticket_id, 'agreement_id', a.id, 'name', a.name, 'reference', a.reference, 'status', a.status,
           'sla_active', a.status IN ('active', 'renewal_due'), 'sla_name', a.terms -> 'sla' ->> 'name',
           'sla_applied', public.sa_ticket_uses_agreement_sla(st.ticket_id, NULLIF(a.terms -> 'sla' ->> 'policy_id', '')::uuid, NULLIF(a.terms -> 'sla' ->> 'version', '')::int))), '[]'::jsonb)
    FROM public.sa_tickets st JOIN public.sa_agreements a ON a.id = st.agreement_id
   WHERE st.ticket_id = ANY (_tickets[1:200]) AND public.sa_role(a.id, auth.uid()) IN ('admin', 'client', 'client_member', 'lead', 'team')
$$;

