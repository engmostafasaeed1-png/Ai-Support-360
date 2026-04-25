-- Status column with safe default
ALTER TABLE public.client_testimonials
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'published')),
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by UUID,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT;

-- Backfill existing rows so nothing disappears from the public site
UPDATE public.client_testimonials
SET status = 'published',
    published_at = COALESCE(published_at, now())
WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS idx_client_testimonials_status
  ON public.client_testimonials (status);

-- ── Replace the read policy: public sees only published+active rows ──
DROP POLICY IF EXISTS "Anyone can view active testimonials" ON public.client_testimonials;

CREATE POLICY "Public can view published testimonials"
  ON public.client_testimonials FOR SELECT
  USING (
    (status = 'published' AND is_active = true)
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- ── Tighten the UPDATE policy: admins can edit, but only super_admins
--    can flip a row to or from `published`. We enforce this via a
--    BEFORE UPDATE trigger so we can compare OLD/NEW.status. ──────────
CREATE OR REPLACE FUNCTION public.guard_testimonial_publish()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _is_super BOOLEAN := public.has_role(auth.uid(), 'super_admin');
  _is_admin BOOLEAN := public.has_role(auth.uid(), 'admin');
BEGIN
  -- Only super_admins can move a row INTO 'published'
  IF NEW.status = 'published' AND OLD.status <> 'published' THEN
    IF NOT _is_super THEN
      RAISE EXCEPTION 'Only super admins can publish testimonials' USING ERRCODE = '42501';
    END IF;
    NEW.published_at := COALESCE(NEW.published_at, now());
    NEW.published_by := COALESCE(NEW.published_by, auth.uid());
    NEW.rejected_reason := NULL;
  END IF;

  -- Only super_admins can move a row OUT of 'published'
  IF OLD.status = 'published' AND NEW.status <> 'published' THEN
    IF NOT _is_super THEN
      RAISE EXCEPTION 'Only super admins can unpublish testimonials' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Track submissions for review (any admin can submit)
  IF NEW.status = 'pending_review' AND OLD.status <> 'pending_review' THEN
    IF NOT (_is_admin OR _is_super) THEN
      RAISE EXCEPTION 'Only admins can submit testimonials for review' USING ERRCODE = '42501';
    END IF;
    NEW.submitted_at := COALESCE(NEW.submitted_at, now());
    NEW.submitted_by := COALESCE(NEW.submitted_by, auth.uid());
  END IF;

  -- Any content edit on a published row by an admin (non-super) sends
  -- it back to pending_review. Super-admins can edit in place.
  IF OLD.status = 'published'
     AND NEW.status = 'published'
     AND NOT _is_super
     AND (
       OLD.name           IS DISTINCT FROM NEW.name
       OR OLD.role        IS DISTINCT FROM NEW.role
       OR OLD.company     IS DISTINCT FROM NEW.company
       OR OLD.quote       IS DISTINCT FROM NEW.quote
       OR OLD.rating      IS DISTINCT FROM NEW.rating
       OR OLD.accent      IS DISTINCT FROM NEW.accent
       OR OLD.logo_url    IS DISTINCT FROM NEW.logo_url
     )
  THEN
    NEW.status := 'pending_review';
    NEW.submitted_at := now();
    NEW.submitted_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_testimonial_publish ON public.client_testimonials;
CREATE TRIGGER guard_testimonial_publish
  BEFORE UPDATE ON public.client_testimonials
  FOR EACH ROW EXECUTE FUNCTION public.guard_testimonial_publish();

-- ── Insert policy: any admin can create, but new rows must start as
--    draft or pending_review (cannot self-publish on insert). ─────────
DROP POLICY IF EXISTS "Admins can insert testimonials" ON public.client_testimonials;

CREATE POLICY "Admins can insert testimonials"
  ON public.client_testimonials FOR INSERT
  WITH CHECK (
    (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
    AND (
      status IN ('draft', 'pending_review')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );