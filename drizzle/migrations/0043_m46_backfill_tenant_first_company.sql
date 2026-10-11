-- M46: a session or a payment that was written before the person had a second company, and that belongs to no company,
-- belongs to the first company of that person (the screens show a record without company in every company).
UPDATE public.sessions s
   SET tenant_id = f.first_tenant
  FROM (
    SELECT m.user_id,
           (array_agg(m.tenant_id ORDER BY m.created_at))[1] AS first_tenant,
           (array_agg(m.created_at ORDER BY m.created_at))[2] AS second_at
      FROM public.tenant_members m
     GROUP BY m.user_id
    HAVING count(*) > 1
  ) f
 WHERE s.tenant_id IS NULL
   AND s.client_id = f.user_id
   AND s.created_at < f.second_at;

UPDATE public.payments p
   SET tenant_id = f.first_tenant
  FROM (
    SELECT m.user_id,
           (array_agg(m.tenant_id ORDER BY m.created_at))[1] AS first_tenant,
           (array_agg(m.created_at ORDER BY m.created_at))[2] AS second_at
      FROM public.tenant_members m
     GROUP BY m.user_id
    HAVING count(*) > 1
  ) f
 WHERE p.tenant_id IS NULL
   AND p.client_id = f.user_id
   AND p.created_at < f.second_at;