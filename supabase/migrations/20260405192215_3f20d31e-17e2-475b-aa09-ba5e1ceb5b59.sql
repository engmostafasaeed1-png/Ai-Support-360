
-- Fix user_roles: explicitly block non-admin INSERT
-- The ALL policy only covers admins. Add a restrictive policy to block non-admin inserts.
-- First, let's add an explicit INSERT policy that only allows admins
CREATE POLICY "Only admins can insert roles"
ON public.user_roles FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'));
