
-- Create enum types
CREATE TYPE public.app_role AS ENUM ('client', 'consultant', 'admin');
CREATE TYPE public.ticket_status AS ENUM ('new', 'under_review', 'matched', 'in_progress', 'waiting_for_client', 'resolved', 'closed');
CREATE TYPE public.session_type AS ENUM ('chat', 'video', 'screen_share');
CREATE TYPE public.session_status AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.payment_status AS ENUM ('pending', 'completed', 'refunded', 'disputed');
CREATE TYPE public.payout_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE public.verification_status AS ENUM ('pending', 'under_review', 'verified', 'rejected', 'suspended');
CREATE TYPE public.urgency_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE public.article_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE public.message_type AS ENUM ('text', 'file', 'voice_note', 'system');
CREATE TYPE public.project_status AS ENUM ('planning', 'active', 'on_hold', 'completed', 'cancelled');
CREATE TYPE public.availability_status AS ENUM ('available', 'busy', 'offline');

-- Helper function for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ===== PROFILES =====
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  preferred_language TEXT DEFAULT 'en',
  onboarding_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== USER ROLES =====
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer to check roles (avoids recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ===== CONSULTANTS =====
CREATE TABLE public.consultants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  bio TEXT,
  hourly_rate NUMERIC(10,2) DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  timezone TEXT DEFAULT 'Asia/Riyadh',
  languages TEXT[] DEFAULT '{"en"}',
  industries TEXT[] DEFAULT '{}',
  verification_status verification_status DEFAULT 'pending',
  rating NUMERIC(3,2) DEFAULT 0,
  total_reviews INT DEFAULT 0,
  response_time_minutes INT DEFAULT 0,
  availability_status availability_status DEFAULT 'offline',
  cv_url TEXT,
  profile_video_url TEXT,
  ai_skills_score NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.consultants ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_consultants_updated_at BEFORE UPDATE ON public.consultants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== CONSULTANT SKILLS =====
CREATE TABLE public.consultant_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  sap_module TEXT NOT NULL,
  proficiency_level INT DEFAULT 1 CHECK (proficiency_level BETWEEN 1 AND 5),
  years_experience INT DEFAULT 0,
  certified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.consultant_skills ENABLE ROW LEVEL SECURITY;

-- ===== CERTIFICATIONS =====
CREATE TABLE public.certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  issuer TEXT,
  issue_date DATE,
  expiry_date DATE,
  document_url TEXT,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;

-- ===== AVAILABILITY SLOTS =====
CREATE TABLE public.availability_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  day_of_week INT CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_recurring BOOLEAN DEFAULT true,
  specific_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

-- ===== TICKETS =====
CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consultant_id UUID REFERENCES public.consultants(id),
  title TEXT NOT NULL,
  description TEXT,
  sap_module TEXT NOT NULL,
  urgency urgency_level DEFAULT 'medium',
  status ticket_status DEFAULT 'new',
  preferred_language TEXT DEFAULT 'en',
  preferred_session_type session_type,
  sla_deadline TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  ai_suggested_category TEXT,
  ai_suggested_priority TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_tickets_client ON public.tickets(client_id);
CREATE INDEX idx_tickets_consultant ON public.tickets(consultant_id);
CREATE INDEX idx_tickets_status ON public.tickets(status);

-- ===== SESSIONS =====
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES public.tickets(id),
  client_id UUID NOT NULL REFERENCES auth.users(id),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id),
  session_type session_type DEFAULT 'chat',
  status session_status DEFAULT 'scheduled',
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_minutes INT DEFAULT 0,
  recording_url TEXT,
  notes TEXT,
  ai_summary TEXT,
  ai_action_items TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== MESSAGES =====
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id),
  content TEXT,
  message_type message_type DEFAULT 'text',
  file_url TEXT,
  file_name TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_messages_session ON public.messages(session_id);

-- ===== PAYMENTS =====
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.sessions(id),
  client_id UUID NOT NULL REFERENCES auth.users(id),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id),
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  vat_amount NUMERIC(12,2) DEFAULT 0,
  status payment_status DEFAULT 'pending',
  payment_method TEXT,
  invoice_number TEXT UNIQUE,
  stripe_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== PAYOUTS =====
CREATE TABLE public.payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id),
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  status payout_status DEFAULT 'pending',
  payout_method TEXT,
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_payouts_updated_at BEFORE UPDATE ON public.payouts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== RATINGS =====
CREATE TABLE public.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id),
  client_id UUID NOT NULL REFERENCES auth.users(id),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id),
  score INT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

-- ===== NOTIFICATIONS =====
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT,
  is_read BOOLEAN DEFAULT false,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_notifications_user ON public.notifications(user_id);

-- ===== AUDIT LOGS =====
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ===== KNOWLEDGE ARTICLES =====
CREATE TABLE public.knowledge_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  content TEXT,
  sap_module TEXT,
  tags TEXT[] DEFAULT '{}',
  status article_status DEFAULT 'draft',
  views_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.knowledge_articles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_knowledge_articles_updated_at BEFORE UPDATE ON public.knowledge_articles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== PROJECTS =====
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES auth.users(id),
  consultant_id UUID REFERENCES public.consultants(id),
  title TEXT NOT NULL,
  description TEXT,
  status project_status DEFAULT 'planning',
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== ATTACHMENTS =====
CREATE TABLE public.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- ===== AUTO-CREATE PROFILE ON SIGNUP =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========================================
-- RLS POLICIES
-- ========================================

-- PROFILES
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- USER ROLES
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- CONSULTANTS
CREATE POLICY "Consultants are publicly readable" ON public.consultants FOR SELECT USING (true);
CREATE POLICY "Consultants can update own profile" ON public.consultants FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Consultants can insert own profile" ON public.consultants FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can manage consultants" ON public.consultants FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- CONSULTANT SKILLS
CREATE POLICY "Skills are publicly readable" ON public.consultant_skills FOR SELECT USING (true);
CREATE POLICY "Consultants can manage own skills" ON public.consultant_skills FOR ALL USING (
  EXISTS (SELECT 1 FROM public.consultants WHERE id = consultant_id AND user_id = auth.uid())
);

-- CERTIFICATIONS
CREATE POLICY "Certs are publicly readable" ON public.certifications FOR SELECT USING (true);
CREATE POLICY "Consultants can manage own certs" ON public.certifications FOR ALL USING (
  EXISTS (SELECT 1 FROM public.consultants WHERE id = consultant_id AND user_id = auth.uid())
);

-- AVAILABILITY SLOTS
CREATE POLICY "Slots are publicly readable" ON public.availability_slots FOR SELECT USING (true);
CREATE POLICY "Consultants can manage own slots" ON public.availability_slots FOR ALL USING (
  EXISTS (SELECT 1 FROM public.consultants WHERE id = consultant_id AND user_id = auth.uid())
);

-- TICKETS
CREATE POLICY "Clients can view own tickets" ON public.tickets FOR SELECT USING (auth.uid() = client_id);
CREATE POLICY "Consultants can view assigned tickets" ON public.tickets FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.consultants WHERE id = consultant_id AND user_id = auth.uid())
);
CREATE POLICY "Admins can view all tickets" ON public.tickets FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Clients can create tickets" ON public.tickets FOR INSERT WITH CHECK (auth.uid() = client_id);
CREATE POLICY "Clients can update own tickets" ON public.tickets FOR UPDATE USING (auth.uid() = client_id);
CREATE POLICY "Admins can manage tickets" ON public.tickets FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- SESSIONS
CREATE POLICY "Participants can view sessions" ON public.sessions FOR SELECT USING (
  auth.uid() = client_id OR EXISTS (SELECT 1 FROM public.consultants WHERE id = consultant_id AND user_id = auth.uid())
);
CREATE POLICY "Admins can view all sessions" ON public.sessions FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Participants can create sessions" ON public.sessions FOR INSERT WITH CHECK (
  auth.uid() = client_id OR EXISTS (SELECT 1 FROM public.consultants WHERE id = consultant_id AND user_id = auth.uid())
);
CREATE POLICY "Participants can update sessions" ON public.sessions FOR UPDATE USING (
  auth.uid() = client_id OR EXISTS (SELECT 1 FROM public.consultants WHERE id = consultant_id AND user_id = auth.uid())
);

-- MESSAGES
CREATE POLICY "Session participants can view messages" ON public.messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND (s.client_id = auth.uid() OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = s.consultant_id AND c.user_id = auth.uid())))
);
CREATE POLICY "Session participants can send messages" ON public.messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Admins can view all messages" ON public.messages FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- PAYMENTS
CREATE POLICY "Clients can view own payments" ON public.payments FOR SELECT USING (auth.uid() = client_id);
CREATE POLICY "Consultants can view own payments" ON public.payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.consultants WHERE id = consultant_id AND user_id = auth.uid())
);
CREATE POLICY "Admins can manage payments" ON public.payments FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- PAYOUTS
CREATE POLICY "Consultants can view own payouts" ON public.payouts FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.consultants WHERE id = consultant_id AND user_id = auth.uid())
);
CREATE POLICY "Admins can manage payouts" ON public.payouts FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RATINGS
CREATE POLICY "Ratings are publicly readable" ON public.ratings FOR SELECT USING (true);
CREATE POLICY "Clients can create ratings" ON public.ratings FOR INSERT WITH CHECK (auth.uid() = client_id);

-- NOTIFICATIONS
CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);

-- AUDIT LOGS
CREATE POLICY "Admins can view audit logs" ON public.audit_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "System can insert audit logs" ON public.audit_logs FOR INSERT WITH CHECK (true);

-- KNOWLEDGE ARTICLES
CREATE POLICY "Published articles are public" ON public.knowledge_articles FOR SELECT USING (status = 'published');
CREATE POLICY "Authors can manage own articles" ON public.knowledge_articles FOR ALL USING (auth.uid() = author_id);
CREATE POLICY "Admins can manage all articles" ON public.knowledge_articles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- PROJECTS
CREATE POLICY "Clients can view own projects" ON public.projects FOR SELECT USING (auth.uid() = client_id);
CREATE POLICY "Consultants can view assigned projects" ON public.projects FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.consultants WHERE id = consultant_id AND user_id = auth.uid())
);
CREATE POLICY "Admins can manage projects" ON public.projects FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Clients can create projects" ON public.projects FOR INSERT WITH CHECK (auth.uid() = client_id);

-- ATTACHMENTS
CREATE POLICY "Uploaders can view own attachments" ON public.attachments FOR SELECT USING (auth.uid() = uploaded_by);
CREATE POLICY "Users can upload attachments" ON public.attachments FOR INSERT WITH CHECK (auth.uid() = uploaded_by);
CREATE POLICY "Admins can view all attachments" ON public.attachments FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
