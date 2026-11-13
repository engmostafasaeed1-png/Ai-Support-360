-- Prepared only. Do not apply without owner approval. Reuses the existing audited RPC; no new tables.
CREATE OR REPLACE FUNCTION public.admin_consultant_full_profile(_cid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c public.consultants;
  _out jsonb;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::app_role), false)
     AND NOT COALESCE(public.has_role(auth.uid(), 'super_admin'::app_role), false) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF NOT public.admin_can(auth.uid(), 'consultants.verify') AND NOT public.admin_can(auth.uid(), 'users.read') THEN RAISE EXCEPTION 'Profile review permission required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _c FROM public.consultants WHERE id = _cid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultant not found' USING ERRCODE = 'P0002';
  END IF;
  _out := jsonb_build_object(
    'consultant', to_jsonb(_c) - 'location',
    'account', (SELECT jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'provider', u.raw_app_meta_data ->> 'provider')
                  FROM auth.users u WHERE u.id = _c.user_id),
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.user_id = _c.user_id),
    'private', (SELECT to_jsonb(x) FROM public.consultant_private x WHERE x.consultant_id = _c.id),
    'skills', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sap_module) FROM public.consultant_skills x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'certifications', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.issue_date DESC NULLS LAST) FROM public.certifications x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'work_history', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.start_date DESC NULLS LAST) FROM public.consultant_work_history x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'education', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.end_year DESC NULLS LAST) FROM public.consultant_education x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'projects', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM public.consultant_projects x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'availability', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.day_of_week NULLS LAST, x.start_time) FROM public.availability_slots x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'interviews', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT id, status, interview_type, interview_style, overall_score, technical_score, soft_skills_score, ai_summary, started_at, completed_at, created_at FROM public.interview_sessions WHERE consultant_id = _c.id ORDER BY created_at DESC LIMIT 10) x), '[]'::jsonb),
    'finance_allowed', public.admin_can(auth.uid(), 'finance.view'),
    'payout', (SELECT CASE WHEN public.admin_can(auth.uid(), 'finance.view') THEN to_jsonb(x) ELSE jsonb_build_object('present',true,'verified_at',x.verified_at,'acknowledged_at',x.acknowledged_at) END FROM public.consultant_payout_details x WHERE x.consultant_id = _c.id),
    'review_view_version', 1,
    'completion', public.consultant_completion(_c.id),
    'verification_items', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM public.consultant_verification_items x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'achievements', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sort, x.created_at) FROM public.consultant_achievements x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'reviews', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'score',x.score,'comment',x.comment,'created_at',x.created_at,'communication',x.communication_score,'technical',x.technical_expertise_score,'responsiveness',x.responsiveness_score) ORDER BY x.created_at DESC) FROM public.ratings x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'responsiveness', (SELECT to_jsonb(x) FROM public.consultant_responsiveness x WHERE x.consultant_id = _c.id),
    'success', (SELECT to_jsonb(x) FROM public.consultant_success_stats x WHERE x.consultant_id = _c.id),
    'flags', (SELECT jsonb_build_object('tags',x.tags,'suspended_at',x.suspended_at,'suspended_reason',x.suspended_reason,'deleted_at',x.deleted_at,'delete_reason',x.delete_reason) FROM public.user_admin_state x WHERE x.user_id = _c.user_id),
    'referral', (SELECT jsonb_build_object('code',x.code,'source',x.source,'status',x.status,'flags',x.flags,'attributed_at',x.attributed_at) FROM public.consultant_referrals x WHERE x.referred_consultant_id = _c.id),
    'ndas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'signed_at',x.signed_at,'client_signed_at',x.client_signed_at,'revoked_at',x.revoked_at) ORDER BY x.signed_at DESC) FROM public.nda_agreements x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'policy_acceptances', COALESCE((SELECT jsonb_agg(jsonb_build_object('version',x.version,'accepted_at',x.accepted_at,'language',x.language) ORDER BY x.accepted_at DESC) FROM public.consultant_policy_acknowledgements x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'review_history', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM public.consultant_verification_audit x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'item_history', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM public.audit_logs x WHERE x.entity_id = _c.id AND x.action = 'admin_profile_item_review'), '[]'::jsonb),
    'missing_required_fields', public.consultant_submission_missing(_c.id),
    'counts', jsonb_build_object(
      'tickets_assigned', (SELECT count(*) FROM public.tickets t WHERE t.consultant_id = _c.id),
      'bids', (SELECT count(*) FROM public.proposals p WHERE p.consultant_id = _c.id),
      'ndas_signed', (SELECT count(*) FROM public.nda_agreements n WHERE n.consultant_id = _c.id AND n.revoked_at IS NULL))
  );
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'admin_viewed_consultant_profile', 'consultant', _cid, jsonb_build_object('at', now()));
  RETURN _out;
END
$function$;
REVOKE ALL ON FUNCTION public.admin_consultant_full_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_consultant_full_profile(uuid) TO authenticated;

-- Atomic item review, reusing existing decision triggers and mail deduplication. No second mail system.
CREATE OR REPLACE FUNCTION public.admin_profile_review_item(_cid uuid, _kind text, _item uuid, _outcome text, _comment text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _c public.consultants;
  _note text := NULLIF(btrim(COALESCE(_comment, '')), '');
  _approved boolean := _outcome = 'approved';
  _before boolean;
  _label text;
  _subject text := _kind;
  _event uuid := gen_random_uuid();
  _dedupe text;
  _previous_outcome text := COALESCE(current_setting('app.ame_review_outcome', true), '');
  _previous text := COALESCE(current_setting('app.ame_decision_comment', true), '');
BEGIN
  IF NOT public.admin_can(auth.uid(), 'consultants.verify') THEN RAISE EXCEPTION 'Review permission required' USING ERRCODE = '42501'; END IF;
  IF _kind IS NULL OR _kind NOT IN ('certificate','linkedin','credly','document') OR _outcome IS NULL OR _outcome NOT IN ('approved','changes') THEN RAISE EXCEPTION 'Unknown review item or decision' USING ERRCODE = '22023'; END IF;
  IF char_length(COALESCE(_note,'')) > 1000 THEN RAISE EXCEPTION 'Comment too long (1000 characters maximum)' USING ERRCODE = '22023'; END IF;
  IF public.bm_has_secret(COALESCE(_note,'')) THEN RAISE EXCEPTION 'Remove secrets from the comment' USING ERRCODE = '22023'; END IF;
  IF _note IS NOT NULL AND public.contact_details_in_text(_note) THEN RAISE EXCEPTION 'Remove contact details and links from the comment' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _c FROM public.consultants WHERE id=_cid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultant not found' USING ERRCODE = 'P0002'; END IF;
  IF _c.user_id=auth.uid() THEN RAISE EXCEPTION 'You cannot review your own profile' USING ERRCODE = '42501'; END IF;
  _dedupe := _kind || ':' || COALESCE(_item::text,_cid::text) || ':' || _outcome || ':' || md5(COALESCE(_note,''));
  IF EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id=_cid AND action='admin_profile_item_review' AND metadata->>'dedupe'=_dedupe AND created_at > now()-interval '2 minutes') THEN RETURN jsonb_build_object('ok',true,'duplicate',true); END IF;
  IF NOT public.check_rate_limit('admin_profile_item:' || auth.uid()::text,120,3600) THEN RAISE EXCEPTION 'Too many reviews. Try again later.' USING ERRCODE = '54000'; END IF;
  PERFORM set_config('app.ame_decision_comment',COALESCE(_note,''),true);
  PERFORM set_config('app.ame_review_outcome',_outcome,true);
  IF _kind='certificate' THEN
    SELECT verified IS TRUE, name INTO _before,_label FROM public.certifications WHERE id=_item AND consultant_id=_cid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Certificate not found' USING ERRCODE = 'P0002'; END IF;
    UPDATE public.certifications SET verified=_approved WHERE id=_item AND consultant_id=_cid;
  ELSIF _kind='document' THEN
    SELECT status='verified',label INTO _before,_label FROM public.consultant_verification_items WHERE id=_item AND consultant_id=_cid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Document not found' USING ERRCODE = 'P0002'; END IF;
    UPDATE public.consultant_verification_items SET status=CASE WHEN _approved THEN 'verified' ELSE 'open' END,completed_at=CASE WHEN _approved THEN now() ELSE NULL END WHERE id=_item AND consultant_id=_cid;
  ELSE
    _label:=CASE WHEN _kind='linkedin' THEN 'LinkedIn' ELSE 'Credly' END;
    IF (_kind='linkedin' AND NULLIF(btrim(_c.linkedin_url),'') IS NULL) OR (_kind='credly' AND NULLIF(btrim(_c.credly_username),'') IS NULL) THEN RAISE EXCEPTION 'No profile link provided' USING ERRCODE = '22023'; END IF;
    _before:=CASE WHEN _kind='linkedin' THEN _c.linkedin_checked_at IS NOT NULL ELSE _c.credly_checked_at IS NOT NULL END;
    IF _kind='linkedin' THEN UPDATE public.consultants SET linkedin_checked_at=CASE WHEN _approved THEN now() ELSE NULL END WHERE id=_cid;
    ELSE UPDATE public.consultants SET credly_checked_at=CASE WHEN _approved THEN now() ELSE NULL END WHERE id=_cid; END IF;
  END IF;
  -- Same item reference, outcome and comment as the existing trigger: ame_decision_notice returns
  -- the first notice instead of creating a duplicate. Same-state and needs-changes reviews are covered too.
  PERFORM public.ame_decision_notice(_c.user_id,_subject,_outcome,_note,'/consultant/profile',COALESCE(_item::text,_cid::text),_label);
  PERFORM set_config('app.ame_review_outcome',_previous_outcome,true);
  PERFORM set_config('app.ame_decision_comment',_previous,true);
  INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,metadata) VALUES(auth.uid(),'admin_profile_item_review','consultant',_cid,jsonb_build_object('event',_event,'kind',_kind,'item',_item,'outcome',_outcome,'comment',_note,'dedupe',_dedupe));
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.admin_profile_review_item(uuid,text,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_profile_review_item(uuid,text,uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ame_on_certificate_review()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.ame_is_admin(auth.uid()) OR NEW.verified IS NOT DISTINCT FROM OLD.verified THEN RETURN NULL; END IF;
  IF NOT (NEW.verified IS TRUE OR OLD.verified IS TRUE) THEN RETURN NULL; END IF;
  PERFORM public.ame_decision_notice((SELECT c.user_id FROM public.consultants c WHERE c.id = NEW.consultant_id), 'certificate',
    COALESCE(NULLIF(current_setting('app.ame_review_outcome',true),''), CASE WHEN NEW.verified IS TRUE THEN 'approved' ELSE 'unverified' END),
    NULLIF(current_setting('app.ame_decision_comment', true), ''), '/consultant/profile', NEW.id::text, NEW.name);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'certificate decision notice skipped: %', SQLERRM;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.ame_on_certificate_review() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ame_on_link_review()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _c text := NULLIF(current_setting('app.ame_decision_comment', true), '');
BEGIN
  IF NOT public.ame_is_admin(auth.uid()) THEN RETURN NULL; END IF;
  IF (OLD.linkedin_checked_at IS NULL) <> (NEW.linkedin_checked_at IS NULL) THEN
    PERFORM public.ame_decision_notice(NEW.user_id, 'linkedin', COALESCE(NULLIF(current_setting('app.ame_review_outcome',true),''), CASE WHEN NEW.linkedin_checked_at IS NOT NULL THEN 'approved' ELSE 'unverified' END),
      _c, '/consultant/profile', NEW.id::text);
  END IF;
  IF (OLD.credly_checked_at IS NULL) <> (NEW.credly_checked_at IS NULL) THEN
    PERFORM public.ame_decision_notice(NEW.user_id, 'credly', COALESCE(NULLIF(current_setting('app.ame_review_outcome',true),''), CASE WHEN NEW.credly_checked_at IS NOT NULL THEN 'approved' ELSE 'unverified' END),
      _c, '/consultant/profile', NEW.id::text);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'link decision notice skipped: %', SQLERRM;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.ame_on_link_review() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ame_on_item_review()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.ame_is_admin(auth.uid()) OR NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status <> 'verified' THEN RETURN NULL; END IF;
  PERFORM public.ame_decision_notice((SELECT c.user_id FROM public.consultants c WHERE c.id = NEW.consultant_id), 'document', COALESCE(NULLIF(current_setting('app.ame_review_outcome',true),''),'approved'),
    NULLIF(current_setting('app.ame_decision_comment', true), ''), '/consultant/verification', NEW.id::text, NEW.label);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'document decision notice skipped: %', SQLERRM;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.ame_on_item_review() FROM PUBLIC, anon, authenticated;

-- Generic role router. Reuses admin_user_detail and admin_consultant_full_profile; no browser table grants.
CREATE OR REPLACE FUNCTION public.admin_user_full_profile(_uid uuid DEFAULT NULL, _cid uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _base jsonb;
  _account jsonb;
  _roles jsonb;
  _consultant jsonb;
  _client jsonb;
  _finance boolean;
  _pause jsonb;
  _preferences jsonb;
  _cid_resolved uuid;
BEGIN
  IF NOT COALESCE(public.has_role(_me,'admin'::public.app_role),false) AND NOT COALESCE(public.has_role(_me,'super_admin'::public.app_role),false) THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE='42501'; END IF;
  IF NOT public.admin_can(_me,'users.read') THEN RAISE EXCEPTION 'User profile permission required' USING ERRCODE='42501'; END IF;
  IF (_uid IS NULL) = (_cid IS NULL) THEN RAISE EXCEPTION 'Provide exactly one account or consultant ID' USING ERRCODE='22023'; END IF;
  IF _cid IS NOT NULL THEN SELECT user_id INTO _uid FROM public.consultants WHERE id=_cid; END IF;
  IF _uid IS NULL THEN RAISE EXCEPTION 'User not found' USING ERRCODE='P0002'; END IF;
  _base := public.admin_user_detail(_uid);
  _finance := public.admin_can(_me,'finance.view');
  _account := (_base->'user') - 'bank' - 'payout' - 'iban' - 'account_number' - 'swift_bic';
  SELECT COALESCE(jsonb_agg(role::text ORDER BY role::text),'[]'::jsonb) INTO _roles FROM public.user_roles WHERE user_id=_uid;
  SELECT id INTO _cid_resolved FROM public.consultants WHERE user_id=_uid;
  IF _roles ? 'consultant' AND _cid_resolved IS NOT NULL THEN _consultant:=public.admin_consultant_full_profile(_cid_resolved); END IF;
  IF to_regprocedure('public.notification_pause_state(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.notification_pause_state($1)' INTO _pause USING _uid;
  END IF;
  SELECT jsonb_build_object('language',p.preferred_language,'pause',_pause,'new_case_alerts',c.new_case_alerts,'profile_visible',c.profile_visible,'show_availability',c.show_availability)
    INTO _preferences FROM public.profiles p LEFT JOIN public.consultants c ON c.user_id=p.user_id WHERE p.user_id=_uid;
  IF _roles ? 'client' THEN
    _client := jsonb_build_object(
      'company', (SELECT to_jsonb(cp) - 'custom_nda_url' FROM public.client_profiles cp WHERE cp.user_id=_uid),
      'custom_nda_path', (SELECT custom_nda_url FROM public.client_profiles WHERE user_id=_uid),
      'billing', COALESCE((SELECT jsonb_agg(to_jsonb(b)-'updated_by') FROM public.tenant_billing_details b WHERE b.tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=_uid)),'[]'::jsonb),
      'team', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',p.display_name,'role',m.org_role,'tenant_id',m.tenant_id,'joined_at',m.created_at)) FROM public.tenant_members m LEFT JOIN public.profiles p ON p.user_id=m.user_id WHERE m.tenant_id IN (SELECT tenant_id FROM public.tenant_members WHERE user_id=_uid)),'[]'::jsonb),
      'landscape', (SELECT jsonb_build_object('sap_landscape',sap_landscape,'sap_modules',sap_modules,'sap_module_versions',sap_module_versions,'sap_product',sap_product,'sap_version',sap_version,'sap_system_ids',sap_system_ids,'sap_interfaces',sap_interfaces,'sap_landscape_notes',sap_landscape_notes) FROM public.client_profiles WHERE user_id=_uid),
      'tickets', COALESCE((SELECT jsonb_agg(x) FROM (SELECT id,title,status,created_at FROM public.tickets WHERE client_id=_uid ORDER BY created_at DESC LIMIT 100) x),'[]'::jsonb),
      'bids', COALESCE((SELECT jsonb_agg(x) FROM (SELECT p.id,p.ticket_id,p.consultant_id,p.status,p.created_at FROM public.proposals p JOIN public.tickets t ON t.id=p.ticket_id WHERE t.client_id=_uid ORDER BY p.created_at DESC LIMIT 100) x),'[]'::jsonb),
      'payments', COALESCE((SELECT jsonb_agg(x) FROM (SELECT id,invoice_number,status,amount,currency,created_at,paid_at,due_date FROM public.payments WHERE client_id=_uid ORDER BY created_at DESC LIMIT 100) x),'[]'::jsonb),
      'ndas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'signed_at',signed_at,'client_signed_at',client_signed_at,'revoked_at',revoked_at)) FROM public.nda_agreements WHERE client_id=_uid),'[]'::jsonb),
      'terms', COALESCE((SELECT jsonb_agg(jsonb_build_object('reference',reference,'agreed_at',agreed_at,'version',version,'status',status)) FROM public.sa_agreements WHERE client_id=_uid),'[]'::jsonb),
      'ratings_given', COALESCE((SELECT jsonb_agg(jsonb_build_object('score',score,'comment',comment,'created_at',created_at)) FROM public.ratings WHERE client_id=_uid),'[]'::jsonb),
      'ratings_received', COALESCE((SELECT jsonb_agg(jsonb_build_object('score',score,'communication_score',communication_score,'clarity_score',clarity_score,'cooperation_score',cooperation_score,'comment',comment,'hidden',hidden,'hidden_reason',hidden_reason,'created_at',created_at)) FROM public.client_reviews WHERE client_id=_uid),'[]'::jsonb),
      'agreements', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'reference',reference,'status',status,'start_date',start_date,'end_date',end_date)) FROM public.sa_agreements WHERE client_id=_uid),'[]'::jsonb),
      'referral', COALESCE((SELECT jsonb_agg(jsonb_build_object('source',source,'status',status,'created_at',created_at)) FROM public.referrals WHERE referred_user_id=_uid),'[]'::jsonb),
      'decisions', COALESCE((SELECT jsonb_agg(jsonb_build_object('event',event_type,'comment',note,'created_at',created_at)) FROM public.client_approval_events WHERE client_user_id=_uid),'[]'::jsonb)
    );
  END IF;
  -- Unlike the older detail reader's ten-minute audit dedupe, every full-profile open is recorded.
  INSERT INTO public.audit_logs(user_id,action,entity_type,entity_id,metadata)
  VALUES(_me,'admin_viewed_user_full_profile','user',_uid,jsonb_build_object('roles',_roles,'finance_allowed',_finance));
  RETURN jsonb_build_object(
    'roles',_roles,'account',_account,'consultant',_consultant,'client',_client,'finance_allowed',_finance,
    'can_verify_consultant',public.admin_can(_me,'consultants.verify'),'can_message',public.admin_can(_me,'users.message'),'can_review_client',public.admin_can(_me,'users.edit'),
    'preferences',_preferences,'warnings',COALESCE(_base->'flags','{}'::jsonb) || jsonb_build_object('stored_contact_bypass_events',(SELECT count(*) FROM public.audit_logs WHERE (user_id=_uid OR entity_id=_uid) AND action IN ('contact_bypass','contact_bypass_attempt','contact_details_blocked'))),
    'sessions',CASE WHEN public.admin_can(_me,'users.sessions') THEN _base->'sessions' ELSE '[]'::jsonb END,
    'activity',COALESCE((SELECT jsonb_agg(x - 'metadata') FROM jsonb_array_elements(COALESCE(_base->'timeline','[]'::jsonb)) x),'[]'::jsonb),'decisions',_base->'notifications',
    'messages',COALESCE((SELECT jsonb_agg(x) FROM (SELECT n.id,n.title,n.body,n.created_at,n.is_read FROM public.notifications n WHERE n.user_id=_uid AND (n.type IN ('admin_message','approval') OR n.meta->>'category'='decision') ORDER BY n.created_at DESC LIMIT 100) x),'[]'::jsonb),
    'emails',COALESCE((SELECT jsonb_agg(x) FROM (SELECT id,notification_id,status,reason,kind,attempts,created_at,finished_at FROM public.admin_message_emails WHERE recipient=_uid ORDER BY created_at DESC LIMIT 100) x),'[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_user_full_profile(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_user_full_profile(uuid,uuid) TO authenticated;
