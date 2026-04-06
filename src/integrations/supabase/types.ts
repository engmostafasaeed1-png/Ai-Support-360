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
      chatbot_conversations: {
        Row: {
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chatbot_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chatbot_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_profiles: {
        Row: {
          communication_preference: string | null
          company_description: string | null
          company_logo_url: string | null
          company_name: string | null
          company_size: string | null
          company_website: string | null
          created_at: string
          headquarters: string | null
          id: string
          industry: string | null
          key_contacts: Json | null
          onboarding_completed: boolean | null
          phone: string | null
          preferred_language: string | null
          sap_hosting_type: string | null
          sap_landscape: string | null
          sap_module_versions: Json | null
          sap_modules: string[] | null
          sap_system_ids: string[] | null
          timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          communication_preference?: string | null
          company_description?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          company_size?: string | null
          company_website?: string | null
          created_at?: string
          headquarters?: string | null
          id?: string
          industry?: string | null
          key_contacts?: Json | null
          onboarding_completed?: boolean | null
          phone?: string | null
          preferred_language?: string | null
          sap_hosting_type?: string | null
          sap_landscape?: string | null
          sap_module_versions?: Json | null
          sap_modules?: string[] | null
          sap_system_ids?: string[] | null
          timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          communication_preference?: string | null
          company_description?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          company_size?: string | null
          company_website?: string | null
          created_at?: string
          headquarters?: string | null
          id?: string
          industry?: string | null
          key_contacts?: Json | null
          onboarding_completed?: boolean | null
          phone?: string | null
          preferred_language?: string | null
          sap_hosting_type?: string | null
          sap_landscape?: string | null
          sap_module_versions?: Json | null
          sap_modules?: string[] | null
          sap_system_ids?: string[] | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      consultant_education: {
        Row: {
          consultant_id: string
          created_at: string
          degree: string | null
          end_year: number | null
          field_of_study: string | null
          id: string
          institution: string
          start_year: number | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          degree?: string | null
          end_year?: number | null
          field_of_study?: string | null
          id?: string
          institution: string
          start_year?: number | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          degree?: string | null
          end_year?: number | null
          field_of_study?: string | null
          id?: string
          institution?: string
          start_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_education_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_projects: {
        Row: {
          client_industry: string | null
          consultant_id: string
          created_at: string
          description: string | null
          duration_months: number | null
          id: string
          project_name: string
          role: string | null
          sap_modules: string[] | null
        }
        Insert: {
          client_industry?: string | null
          consultant_id: string
          created_at?: string
          description?: string | null
          duration_months?: number | null
          id?: string
          project_name: string
          role?: string | null
          sap_modules?: string[] | null
        }
        Update: {
          client_industry?: string | null
          consultant_id?: string
          created_at?: string
          description?: string | null
          duration_months?: number | null
          id?: string
          project_name?: string
          role?: string | null
          sap_modules?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_projects_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
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
      consultant_work_history: {
        Row: {
          company_name: string
          consultant_id: string
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          is_current: boolean | null
          job_title: string
          start_date: string | null
        }
        Insert: {
          company_name: string
          consultant_id: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_current?: boolean | null
          job_title: string
          start_date?: string | null
        }
        Update: {
          company_name?: string
          consultant_id?: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_current?: boolean | null
          job_title?: string
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_work_history_consultant_id_fkey"
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
          city: string | null
          country: string | null
          created_at: string
          credly_username: string | null
          currency: string | null
          cv_url: string | null
          github_url: string | null
          hourly_rate: number | null
          id: string
          industries: string[] | null
          languages: string[] | null
          linkedin_url: string | null
          location: unknown
          nationality: string | null
          personal_website: string | null
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
          city?: string | null
          country?: string | null
          created_at?: string
          credly_username?: string | null
          currency?: string | null
          cv_url?: string | null
          github_url?: string | null
          hourly_rate?: number | null
          id?: string
          industries?: string[] | null
          languages?: string[] | null
          linkedin_url?: string | null
          location?: unknown
          nationality?: string | null
          personal_website?: string | null
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
          city?: string | null
          country?: string | null
          created_at?: string
          credly_username?: string | null
          currency?: string | null
          cv_url?: string | null
          github_url?: string | null
          hourly_rate?: number | null
          id?: string
          industries?: string[] | null
          languages?: string[] | null
          linkedin_url?: string | null
          location?: unknown
          nationality?: string | null
          personal_website?: string | null
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
      environment_connections: {
        Row: {
          created_at: string
          environment_id: string
          guacamole_url: string
          id: string
          is_default: boolean
          name: string
          protocol: Database["public"]["Enums"]["guac_protocol"]
        }
        Insert: {
          created_at?: string
          environment_id: string
          guacamole_url: string
          id?: string
          is_default?: boolean
          name: string
          protocol?: Database["public"]["Enums"]["guac_protocol"]
        }
        Update: {
          created_at?: string
          environment_id?: string
          guacamole_url?: string
          id?: string
          is_default?: boolean
          name?: string
          protocol?: Database["public"]["Enums"]["guac_protocol"]
        }
        Relationships: [
          {
            foreignKeyName: "environment_connections_environment_id_fkey"
            columns: ["environment_id"]
            isOneToOne: false
            referencedRelation: "remote_environments"
            referencedColumns: ["id"]
          },
        ]
      }
      environment_sessions: {
        Row: {
          connected_at: string
          disconnected_at: string | null
          duration_minutes: number | null
          environment_id: string
          id: string
          user_id: string
        }
        Insert: {
          connected_at?: string
          disconnected_at?: string | null
          duration_minutes?: number | null
          environment_id: string
          id?: string
          user_id: string
        }
        Update: {
          connected_at?: string
          disconnected_at?: string | null
          duration_minutes?: number | null
          environment_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "environment_sessions_environment_id_fkey"
            columns: ["environment_id"]
            isOneToOne: false
            referencedRelation: "remote_environments"
            referencedColumns: ["id"]
          },
        ]
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
          interview_type: Database["public"]["Enums"]["interview_mode"] | null
          overall_score: number | null
          requested_by: string | null
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
          interview_type?: Database["public"]["Enums"]["interview_mode"] | null
          overall_score?: number | null
          requested_by?: string | null
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
          interview_type?: Database["public"]["Enums"]["interview_mode"] | null
          overall_score?: number | null
          requested_by?: string | null
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
      knowledge_solutions: {
        Row: {
          created_at: string
          created_by: string | null
          helpful_count: number | null
          id: string
          problem_description: string | null
          sap_module: string | null
          solution: string | null
          source_ticket_id: string | null
          status: string
          tags: string[] | null
          title: string
          updated_at: string
          views_count: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          helpful_count?: number | null
          id?: string
          problem_description?: string | null
          sap_module?: string | null
          solution?: string | null
          source_ticket_id?: string | null
          status?: string
          tags?: string[] | null
          title: string
          updated_at?: string
          views_count?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          helpful_count?: number | null
          id?: string
          problem_description?: string | null
          sap_module?: string | null
          solution?: string | null
          source_ticket_id?: string | null
          status?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          views_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_solutions_source_ticket_id_fkey"
            columns: ["source_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
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
      nda_agreements: {
        Row: {
          client_id: string
          consultant_id: string
          created_at: string
          id: string
          ip_address: string | null
          nda_content: string
          revoked_at: string | null
          revoked_by: string | null
          signature_data: string
          signature_type: string
          signed_at: string
        }
        Insert: {
          client_id: string
          consultant_id: string
          created_at?: string
          id?: string
          ip_address?: string | null
          nda_content: string
          revoked_at?: string | null
          revoked_by?: string | null
          signature_data: string
          signature_type?: string
          signed_at?: string
        }
        Update: {
          client_id?: string
          consultant_id?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          nda_content?: string
          revoked_at?: string | null
          revoked_by?: string | null
          signature_data?: string
          signature_type?: string
          signed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nda_agreements_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
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
      platform_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
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
          referral_code: string | null
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
          referral_code?: string | null
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
          referral_code?: string | null
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
      referral_rewards: {
        Row: {
          amount: number
          applied_at: string | null
          created_at: string
          currency: string | null
          description: string | null
          id: string
          referral_id: string
          reward_type: string
          status: string
          user_id: string
        }
        Insert: {
          amount?: number
          applied_at?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          referral_id: string
          reward_type?: string
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          applied_at?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          id?: string
          referral_id?: string
          reward_type?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referral_code: string
          referred_email: string | null
          referred_user_id: string | null
          referrer_id: string
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          referral_code: string
          referred_email?: string | null
          referred_user_id?: string | null
          referrer_id: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          referral_code?: string
          referred_email?: string | null
          referred_user_id?: string | null
          referrer_id?: string
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      remote_environments: {
        Row: {
          client_id: string
          consultant_id: string | null
          created_at: string
          guacamole_url: string
          id: string
          name: string
          notes: string | null
          os_type: string | null
          status: Database["public"]["Enums"]["environment_status"]
          updated_at: string
        }
        Insert: {
          client_id: string
          consultant_id?: string | null
          created_at?: string
          guacamole_url: string
          id?: string
          name: string
          notes?: string | null
          os_type?: string | null
          status?: Database["public"]["Enums"]["environment_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string
          consultant_id?: string | null
          created_at?: string
          guacamole_url?: string
          id?: string
          name?: string
          notes?: string | null
          os_type?: string | null
          status?: Database["public"]["Enums"]["environment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "remote_environments_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      session_feedback: {
        Row: {
          action_items: string[] | null
          ai_feedback: string | null
          communication_score: number | null
          created_at: string
          id: string
          improvements: string[] | null
          mom_content: string | null
          overall_score: number | null
          professionalism_score: number | null
          recipient_id: string
          recipient_role: string
          session_id: string
          strengths: string[] | null
          technical_score: number | null
          updated_at: string
        }
        Insert: {
          action_items?: string[] | null
          ai_feedback?: string | null
          communication_score?: number | null
          created_at?: string
          id?: string
          improvements?: string[] | null
          mom_content?: string | null
          overall_score?: number | null
          professionalism_score?: number | null
          recipient_id: string
          recipient_role?: string
          session_id: string
          strengths?: string[] | null
          technical_score?: number | null
          updated_at?: string
        }
        Update: {
          action_items?: string[] | null
          ai_feedback?: string | null
          communication_score?: number | null
          created_at?: string
          id?: string
          improvements?: string[] | null
          mom_content?: string | null
          overall_score?: number | null
          professionalism_score?: number | null
          recipient_id?: string
          recipient_role?: string
          session_id?: string
          strengths?: string[] | null
          technical_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_feedback_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_surveys: {
        Row: {
          created_at: string
          generated_for: string
          generated_for_role: string
          id: string
          questions: Json
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          generated_for: string
          generated_for_role?: string
          id?: string
          questions?: Json
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          generated_for?: string
          generated_for_role?: string
          id?: string
          questions?: Json
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_surveys_session_id_fkey"
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
      survey_responses: {
        Row: {
          answers: Json
          created_at: string
          id: string
          respondent_id: string
          submitted_at: string | null
          survey_id: string
        }
        Insert: {
          answers?: Json
          created_at?: string
          id?: string
          respondent_id: string
          submitted_at?: string | null
          survey_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          id?: string
          respondent_id?: string
          submitted_at?: string | null
          survey_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "session_surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_documents: {
        Row: {
          comment: string | null
          created_at: string
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          mime_type: string | null
          ticket_id: string
          uploaded_by: string
          version: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          ticket_id: string
          uploaded_by: string
          version?: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          ticket_id?: string
          uploaded_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_documents_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_match_requests: {
        Row: {
          consultant_id: string
          created_at: string
          id: string
          message: string | null
          responded_at: string | null
          sent_by: string
          status: Database["public"]["Enums"]["match_request_status"]
          ticket_id: string
          updated_at: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          id?: string
          message?: string | null
          responded_at?: string | null
          sent_by: string
          status?: Database["public"]["Enums"]["match_request_status"]
          ticket_id: string
          updated_at?: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          id?: string
          message?: string | null
          responded_at?: string | null
          sent_by?: string
          status?: Database["public"]["Enums"]["match_request_status"]
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_match_requests_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_match_requests_ticket_id_fkey"
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
      certifications_public: {
        Row: {
          consultant_id: string | null
          created_at: string | null
          expiry_date: string | null
          id: string | null
          issue_date: string | null
          issuer: string | null
          name: string | null
          verified: boolean | null
        }
        Insert: {
          consultant_id?: string | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string | null
          issue_date?: string | null
          issuer?: string | null
          name?: string | null
          verified?: boolean | null
        }
        Update: {
          consultant_id?: string | null
          created_at?: string | null
          expiry_date?: string | null
          id?: string | null
          issue_date?: string | null
          issuer?: string | null
          name?: string | null
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
      environment_status: "active" | "inactive" | "maintenance"
      guac_protocol: "rdp" | "ssh" | "vnc"
      integration_platform: "zendesk" | "freshdesk" | "jira" | "servicenow"
      integration_status: "active" | "inactive" | "error"
      interview_mode: "ai" | "physical" | "online"
      interview_status: "pending" | "in_progress" | "completed" | "reviewed"
      match_request_status: "pending" | "accepted" | "rejected" | "withdrawn"
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
      environment_status: ["active", "inactive", "maintenance"],
      guac_protocol: ["rdp", "ssh", "vnc"],
      integration_platform: ["zendesk", "freshdesk", "jira", "servicenow"],
      integration_status: ["active", "inactive", "error"],
      interview_mode: ["ai", "physical", "online"],
      interview_status: ["pending", "in_progress", "completed", "reviewed"],
      match_request_status: ["pending", "accepted", "rejected", "withdrawn"],
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
