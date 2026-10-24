-- Adversarial tests for ticket-brd.sql. ONE rolled-back transaction: run on a scratch copy (nothing is kept).
-- Each check raises on failure. BR01-BR22.
BEGIN;

-- Fixtures. Client C owns ticket T; consultant K (user k1, consultant kc) is the ticket's consultant with an NDA
-- signed by both; bidder B (consultant bc) has no link; team member M (consultant mc) is ready on the team but has no
-- NDA; admin A; outsider O.
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin');
INSERT INTO public.profiles (user_id, display_name) VALUES ('00000000-0000-0000-0000-0000000000c1', 'Client Person');
INSERT INTO public.consultants (id, user_id) VALUES
  ('00000000-0000-0000-0000-00000000bc01', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000kc01'::text::uuid, '00000000-0000-0000-0000-0000000000k1'::text::uuid)
  ON CONFLICT DO NOTHING;
