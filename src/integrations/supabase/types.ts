export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          mime_type: string | null
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          uploaded_by: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          uploaded_by?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      availability_slots: {
        Row: {
          consultant_id: string
          created_at: string
          day_of_week: number | null
          end_time: string
          id: string
          is_recurring: boolean | null
          specific_date: string | null
          start_time: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          day_of_week?: number | null
          end_time: string
          id?: string
          is_recurring?: boolean | null
          specific_date?: string | null
          start_time: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          day_of_week?: number | null
          end_time?: string
          id?: string
          is_recurring?: boolean | null
          specific_date?: string | null
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_slots_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          consultant_id: string
          created_at: string
          document_url: string | null
          expiry_date: string | null
          id: string
          issue_date: string | null
          issuer: string | null
          name: string
          verified: boolean | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          document_url?: string | null
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          issuer?: string | null
          name: string
          verified?: boolean | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          document_url?: string | null
          expiry_date?: string | null
          id?: string
          issue_date?: string | null
          issuer?: string | null
          name?: string
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "certifications_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_profiles: {
        Row: {
          communication_preference: string | null
          company_name: string | null
          company_size: string | null
          created_at: string
          id: string
          industry: string | null
          onboarding_completed: boolean | null
          phone: string | null
          preferred_language: string | null
          sap_landscape: string | null
          sap_modules: string[] | null
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          communication_preference?: string | null
          company_name?: string | null
          company_size?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          onboarding_completed?: boolean | null
          phone?: string | null
          preferred_language?: string | null
          sap_landscape?: string | null
          sap_modules?: string[] | null
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          communication_preference?: string | null
          company_name?: string | null
          company_size?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          onboarding_completed?: boolean | null
          phone?: string | null
          preferred_language?: string | null
          sap_landscape?: string | null
          sap_modules?: string[] | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      consultant_skills: {
        Row: {
          certified: boolean | null
          consultant_id: string
          created_at: string
          id: string
          proficiency_level: number | null
          sap_module: string
          years_experience: number | null
        }
        Insert: {
          certified?: boolean | null
          consultant_id: string
          created_at?: string
          id?: string
          proficiency_level?: number | null
          sap_module: string
          years_experience?: number | null
        }
        Update: {
          certified?: boolean | null
          consultant_id?: string
          created_at?: string
          id?: string
          proficiency_level?: number | null
          sap_module?: string
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_skills_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      consultants: {
        Row: {
          ai_skills_score: number | null
          availability_status:
            | Database["public"]["Enums"]["availability_status"]
            | null
          bio: string | null
          created_at: string
          currency: string | null
          cv_url: string | null
          hourly_rate: number | null
          id: string
          industries: string[] | null
          languages: string[] | null
          location: unknown
          profile_video_url: string | null
          rating: number | null
          response_time_minutes: number | null
          timezone: string | null
          total_reviews: number | null
          updated_at: string
          user_id: string
          verification_status:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Insert: {
          ai_skills_score?: number | null
          availability_status?:
            | Database["public"]["Enums"]["availability_status"]
            | null
          bio?: string | null
          created_at?: string
          currency?: string | null
          cv_url?: string | null
          hourly_rate?: number | null
          id?: string
          industries?: string[] | null
          languages?: string[] | null
          location?: unknown
          profile_video_url?: string | null
          rating?: number | null
          response_time_minutes?: number | null
          timezone?: string | null
          total_reviews?: number | null
          updated_at?: string
          user_id: string
          verification_status?:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Update: {
          ai_skills_score?: number | null
          availability_status?:
            | Database["public"]["Enums"]["availability_status"]
            | null
          bio?: string | null
          created_at?: string
          currency?: string | null
          cv_url?: string | null
          hourly_rate?: number | null
          id?: string
          industries?: string[] | null
          languages?: string[] | null
          location?: unknown
          profile_video_url?: string | null
          rating?: number | null
          response_time_minutes?: number | null
          timezone?: string | null
          total_reviews?: number | null
          updated_at?: string
          user_id?: string
          verification_status?:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Relationships: []
      }
      integration_sync_log: {
        Row: {
          action: string
          created_at: string
          direction: Database["public"]["Enums"]["sync_direction"]
          entity_type: string
          error_message: string | null
          external_ticket_id: string | null
          id: string
          integration_id: string
          local_ticket_id: string | null
          payload: Json | null
          status: Database["public"]["Enums"]["sync_status"]
        }
        Insert: {
          action: string
          created_at?: string
          direction: Database["public"]["Enums"]["sync_direction"]
          entity_type?: string
          error_message?: string | null
          external_ticket_id?: string | null
          id?: string
          integration_id: string
          local_ticket_id?: string | null
          payload?: Json | null
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Update: {
          action?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["sync_direction"]
          entity_type?: string
          error_message?: string | null
          external_ticket_id?: string | null
          id?: string
          integration_id?: string
          local_ticket_id?: string | null
          payload?: Json | null
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_log_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_sync_log_local_ticket_id_fkey"
            columns: ["local_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          api_key_encrypted: string
          client_id: string
          created_at: string
          external_project_id: string | null
          id: string
          last_synced_at: string | null
          platform: Database["public"]["Enums"]["integration_platform"]
          platform_url: string
          settings: Json
          status: Database["public"]["Enums"]["integration_status"]
          sync_enabled: boolean
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          api_key_encrypted: string
          client_id: string
          created_at?: string
          external_project_id?: string | null
          id?: string
          last_synced_at?: string | null
          platform: Database["public"]["Enums"]["integration_platform"]
          platform_url: string
          settings?: Json
          status?: Database["public"]["Enums"]["integration_status"]
          sync_enabled?: boolean
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          api_key_encrypted?: string
          client_id?: string
          created_at?: string
          external_project_id?: string | null
          id?: string
          last_synced_at?: string | null
          platform?: Database["public"]["Enums"]["integration_platform"]
          platform_url?: string
          settings?: Json
          status?: Database["public"]["Enums"]["integration_status"]
          sync_enabled?: boolean
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: []
      }
      interview_answers: {
        Row: {
          ai_feedback: string | null
          answer_transcript: string | null
          category: string
          created_at: string
          id: string
          interview_id: string
          question: string
          question_order: number
          score: number | null
        }
        Insert: {
          ai_feedback?: string | null
          answer_transcript?: string | null
          category?: string
          created_at?: string
          id?: string
          interview_id: string
          question: string
          question_order?: number
          score?: number | null
        }
        Update: {
          ai_feedback?: string | null
          answer_transcript?: string | null
          category?: string
          created_at?: string
          id?: string
          interview_id?: string
          question?: string
          question_order?: number
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_answers_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_sessions: {
        Row: {
          ai_summary: string | null
          completed_at: string | null
          consultant_id: string
          created_at: string
          id: string
          overall_score: number | null
          skill_results: Json | null
          soft_skills_score: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["interview_status"]
          technical_score: number | null
          updated_at: string
        }
        Insert: {
          ai_summary?: string | null
          completed_at?: string | null
          consultant_id: string
          created_at?: string
          id?: string
          overall_score?: number | null
          skill_results?: Json | null
          soft_skills_score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["interview_status"]
          technical_score?: number | null
          updated_at?: string
        }
        Update: {
          ai_summary?: string | null
          completed_at?: string | null
          consultant_id?: string
          created_at?: string
          id?: string
          overall_score?: number | null
          skill_results?: Json | null
          soft_skills_score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["interview_status"]
          technical_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_sessions_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_articles: {
        Row: {
          author_id: string
          content: string | null
          created_at: string
          id: string
          sap_module: string | null
          status: Database["public"]["Enums"]["article_status"] | null
          tags: string[] | null
          title: string
          updated_at: string
          views_count: number | null
        }
        Insert: {
          author_id: string
          content?: string | null
          created_at?: string
          id?: string
          sap_module?: string | null
          status?: Database["public"]["Enums"]["article_status"] | null
          tags?: string[] | null
          title: string
          updated_at?: string
          views_count?: number | null
        }
        Update: {
          author_id?: string
          content?: string | null
          created_at?: string
          id?: string
          sap_module?: string | null
          status?: Database["public"]["Enums"]["article_status"] | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          views_count?: number | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string | null
          created_at: string
          file_name: string | null
          file_url: string | null
          id: string
          is_read: boolean | null
          message_type: Database["public"]["Enums"]["message_type"] | null
          sender_id: string
          session_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          is_read?: boolean | null
          message_type?: Database["public"]["Enums"]["message_type"] | null
          sender_id: string
          session_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          is_read?: boolean | null
          message_type?: Database["public"]["Enums"]["message_type"] | null
          sender_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean | null
          link: string | null
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          link?: string | null
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          link?: string | null
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          client_id: string
          consultant_id: string
          created_at: string
          currency: string | null
          id: string
          invoice_number: string | null
          payment_method: string | null
          session_id: string | null
          status: Database["public"]["Enums"]["payment_status"] | null
          stripe_payment_id: string | null
          updated_at: string
          vat_amount: number | null
        }
        Insert: {
          amount: number
          client_id: string
          consultant_id: string
          created_at?: string
          currency?: string | null
          id?: string
          invoice_number?: string | null
          payment_method?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          stripe_payment_id?: string | null
          updated_at?: string
          vat_amount?: number | null
        }
        Update: {
          amount?: number
          client_id?: string
          consultant_id?: string
          created_at?: string
          currency?: string | null
          id?: string
          invoice_number?: string | null
          payment_method?: string | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          stripe_payment_id?: string | null
          updated_at?: string
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount: number
          consultant_id: string
          created_at: string
          currency: string | null
          id: string
          payout_method: string | null
          reference: string | null
          status: Database["public"]["Enums"]["payout_status"] | null
          updated_at: string
        }
        Insert: {
          amount: number
          consultant_id: string
          created_at?: string
          currency?: string | null
          id?: string
          payout_method?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["payout_status"] | null
          updated_at?: string
        }
        Update: {
          amount?: number
          consultant_id?: string
          created_at?: string
          currency?: string | null
          id?: string
          payout_method?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["payout_status"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          onboarding_completed: boolean | null
          phone: string | null
          preferred_language: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          onboarding_completed?: boolean | null
          phone?: string | null
          preferred_language?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          onboarding_completed?: boolean | null
          phone?: string | null
          preferred_language?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          client_id: string
          consultant_id: string | null
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"] | null
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          consultant_id?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"] | null
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          consultant_id?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"] | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      ratings: {
        Row: {
          client_id: string
          comment: string | null
          consultant_id: string
          created_at: string
          id: string
          score: number
          session_id: string
        }
        Insert: {
          client_id: string
          comment?: string | null
          consultant_id: string
          created_at?: string
          id?: string
          score: number
          session_id: string
        }
        Update: {
          client_id?: string
          comment?: string | null
          consultant_id?: string
          created_at?: string
          id?: string
          score?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          ai_action_items: string[] | null
          ai_summary: string | null
          client_id: string
          consultant_id: string
          created_at: string
          duration_minutes: number | null
          ended_at: string | null
          id: string
          notes: string | null
          recording_url: string | null
          scheduled_at: string | null
          session_type: Database["public"]["Enums"]["session_type"] | null
          started_at: string | null
          status: Database["public"]["Enums"]["session_status"] | null
          ticket_id: string | null
          updated_at: string
        }
        Insert: {
          ai_action_items?: string[] | null
          ai_summary?: string | null
          client_id: string
          consultant_id: string
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          notes?: string | null
          recording_url?: string | null
          scheduled_at?: string | null
          session_type?: Database["public"]["Enums"]["session_type"] | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"] | null
          ticket_id?: string | null
          updated_at?: string
        }
        Update: {
          ai_action_items?: string[] | null
          ai_summary?: string | null
          client_id?: string
          consultant_id?: string
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          notes?: string | null
          recording_url?: string | null
          scheduled_at?: string | null
          session_type?: Database["public"]["Enums"]["session_type"] | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"] | null
          ticket_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          ai_suggested_category: string | null
          ai_suggested_priority: string | null
          client_id: string
          consultant_id: string | null
          created_at: string
          description: string | null
          id: string
          preferred_language: string | null
          preferred_session_type:
            | Database["public"]["Enums"]["session_type"]
            | null
          resolved_at: string | null
          sap_module: string
          sla_deadline: string | null
          status: Database["public"]["Enums"]["ticket_status"] | null
          title: string
          updated_at: string
          urgency: Database["public"]["Enums"]["urgency_level"] | null
        }
        Insert: {
          ai_suggested_category?: string | null
          ai_suggested_priority?: string | null
          client_id: string
          consultant_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          preferred_language?: string | null
          preferred_session_type?:
            | Database["public"]["Enums"]["session_type"]
            | null
          resolved_at?: string | null
          sap_module: string
          sla_deadline?: string | null
          status?: Database["public"]["Enums"]["ticket_status"] | null
          title: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"] | null
        }
        Update: {
          ai_suggested_category?: string | null
          ai_suggested_priority?: string | null
          client_id?: string
          consultant_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          preferred_language?: string | null
          preferred_session_type?:
            | Database["public"]["Enums"]["session_type"]
            | null
          resolved_at?: string | null
          sap_module?: string
          sla_deadline?: string | null
          status?: Database["public"]["Enums"]["ticket_status"] | null
          title?: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"] | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "client" | "consultant" | "admin"
      article_status: "draft" | "published" | "archived"
      availability_status: "available" | "busy" | "offline"
      integration_platform: "zendesk" | "freshdesk" | "jira" | "servicenow"
      integration_status: "active" | "inactive" | "error"
      interview_status: "pending" | "in_progress" | "completed" | "reviewed"
      message_type: "text" | "file" | "voice_note" | "system"
      payment_status: "pending" | "completed" | "refunded" | "disputed"
      payout_status: "pending" | "processing" | "completed" | "failed"
      project_status:
        | "planning"
        | "active"
        | "on_hold"
        | "completed"
        | "cancelled"
      session_status: "scheduled" | "in_progress" | "completed" | "cancelled"
      session_type: "chat" | "video" | "screen_share"
      sync_direction: "inbound" | "outbound"
      sync_status: "success" | "failed" | "pending" | "skipped"
      ticket_status:
        | "new"
        | "under_review"
        | "matched"
        | "in_progress"
        | "waiting_for_client"
        | "resolved"
        | "closed"
      urgency_level: "low" | "medium" | "high" | "critical"
      verification_status:
        | "pending"
        | "under_review"
        | "verified"
        | "rejected"
        | "suspended"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["client", "consultant", "admin"],
      article_status: ["draft", "published", "archived"],
      availability_status: ["available", "busy", "offline"],
      integration_platform: ["zendesk", "freshdesk", "jira", "servicenow"],
      integration_status: ["active", "inactive", "error"],
      interview_status: ["pending", "in_progress", "completed", "reviewed"],
      message_type: ["text", "file", "voice_note", "system"],
      payment_status: ["pending", "completed", "refunded", "disputed"],
      payout_status: ["pending", "processing", "completed", "failed"],
      project_status: [
        "planning",
        "active",
        "on_hold",
        "completed",
        "cancelled",
      ],
      session_status: ["scheduled", "in_progress", "completed", "cancelled"],
      session_type: ["chat", "video", "screen_share"],
      sync_direction: ["inbound", "outbound"],
      sync_status: ["success", "failed", "pending", "skipped"],
      ticket_status: [
        "new",
        "under_review",
        "matched",
        "in_progress",
        "waiting_for_client",
        "resolved",
        "closed",
      ],
      urgency_level: ["low", "medium", "high", "critical"],
      verification_status: [
        "pending",
        "under_review",
        "verified",
        "rejected",
        "suspended",
      ],
    },
  },
} as const
