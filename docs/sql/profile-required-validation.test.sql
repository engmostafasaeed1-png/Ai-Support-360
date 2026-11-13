-- Run against an isolated database or inside a rolled-back transaction.
BEGIN;
DO $$
BEGIN
 IF public.profile_required_value_present('null'::jsonb) THEN RAISE EXCEPTION 'null accepted'; END IF;
 IF public.profile_required_value_present('"   "'::jsonb) THEN RAISE EXCEPTION 'whitespace accepted'; END IF;
 IF public.profile_required_value_present('["  "]'::jsonb) THEN RAISE EXCEPTION 'blank list accepted'; END IF;
 IF public.client_required_missing('{"company_name":"","sap_modules":[]}'::jsonb) <> ARRAY['company_name','sap_modules'] THEN RAISE EXCEPTION 'empty required fields accepted'; END IF;
 IF cardinality(public.client_required_missing('{"company_name":"Company","sap_modules":["FI"],"industry":null}'::jsonb)) <> 0 THEN RAISE EXCEPTION 'optional field blocked'; END IF;
END $$;
ROLLBACK;