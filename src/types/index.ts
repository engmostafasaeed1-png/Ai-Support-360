export interface Ticket {
  id: string;
  title: string;
  status: 'new' | 'under_review' | 'matched' | 'in_progress' | 'waiting_for_client' | 'resolved' | 'closed';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  sap_module: string;
  description: string;
  client_id: string;
  assigned_to?: string;
  consultant_id?: string;
  created_at: string;
  updated_at: string;
  planned_hours?: number;
  planned_cost?: number;
  cost_currency?: string;
  plan_submitted_at?: string;
  plan_approved?: boolean;
  tenant_id?: string;
}

export interface Consultant {
  id: string;
  user_id: string;
  bio?: string;
  hourly_rate: number;
  currency: string;
  timezone: string;
  languages: string[];
  availability_status: 'available' | 'busy' | 'offline';
  rating: number;
  total_reviews: number;
  verification_status: 'verified' | 'under_review' | 'pending';
  city?: string;
  country?: string;
  industries?: string[];
  cv_url?: string;
  linkedin_url?: string;
  github_url?: string;
  personal_website?: string;
  credly_username?: string;
  ai_skills_score?: number;
  response_time_minutes?: number;
  profile_video_url?: string;
  nationality?: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  scheduled_at: string;
  duration_minutes?: number;
  consultant_id: string;
  session_type: 'chat' | 'video' | 'screen_share';
  meeting_url?: string;
  client_id?: string;
  ticket_id?: string;
  created_at?: string;
}

export interface Payment {
  id: string;
  amount: number;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'completed';
  currency: string;
  created_at: string;
  description?: string;
  invoice_url?: string;
  client_id?: string;
  consultant_id?: string;
}

export interface UserProfile {
  userId: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  role: 'client' | 'consultant' | 'admin' | 'super-admin';
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: string;
  link?: string;
  read: boolean;
  created_at: string;
}

export interface MatchRequest {
  id: string;
  ticket_id: string;
  consultant_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  created_at: string;
  updated_at: string;
}

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  status: string;
  due_date?: string;
  project_id?: string;
  created_at: string;
  updated_at: string;
}
