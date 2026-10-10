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
      ai_suggestion_feedback: {
        Row: {
          areas: string[]
          created_at: string
          id: string
          item_ids: string[]
          mode: string | null
          user_id: string
          verdict: string
        }
        Insert: {
          areas?: string[]
          created_at?: string
          id?: string
          item_ids?: string[]
          mode?: string | null
          user_id?: string
          verdict: string
        }
        Update: {
          areas?: string[]
          created_at?: string
          id?: string
          item_ids?: string[]
          mode?: string | null
          user_id?: string
          verdict?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          event: string
          id: string
          path: string | null
          properties: Json
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          path?: string | null
          properties?: Json
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          path?: string | null
          properties?: Json
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
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
      auto_assignment_rules: {
        Row: {
          assignment_method: string
          consultant_pool: string[] | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          priority: number | null
          sap_module: string | null
          updated_at: string
          urgency: string | null
        }
        Insert: {
          assignment_method?: string
          consultant_pool?: string[] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          priority?: number | null
          sap_module?: string | null
          updated_at?: string
          urgency?: string | null
        }
        Update: {
          assignment_method?: string
          consultant_pool?: string[] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          priority?: number | null
          sap_module?: string | null
          updated_at?: string
          urgency?: string | null
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
      business_process_documents: {
        Row: {
          business_process_id: string
          created_at: string
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          mime_type: string | null
          uploaded_by: string
        }
        Insert: {
          business_process_id: string
          created_at?: string
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          uploaded_by: string
        }
        Update: {
          business_process_id?: string
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_process_documents_business_process_id_fkey"
            columns: ["business_process_id"]
            isOneToOne: false
            referencedRelation: "business_processes"
            referencedColumns: ["id"]
          },
        ]
      }
      business_processes: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          category: string | null
          client_id: string
          consultant_visible: boolean
          created_at: string
          description: string | null
          id: string
          level: number
          name: string
          parent_id: string | null
          process_owner: string | null
          sap_module: string | null
          status: string
          tags: string[] | null
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          category?: string | null
          client_id: string
          consultant_visible?: boolean
          created_at?: string
          description?: string | null
          id?: string
          level?: number
          name: string
          parent_id?: string | null
          process_owner?: string | null
          sap_module?: string | null
          status?: string
          tags?: string[] | null
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          category?: string | null
          client_id?: string
          consultant_visible?: boolean
          created_at?: string
          description?: string | null
          id?: string
          level?: number
          name?: string
          parent_id?: string | null
          process_owner?: string | null
          sap_module?: string | null
          status?: string
          tags?: string[] | null
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_processes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "business_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_processes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      canned_responses: {
        Row: {
          category: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean | null
          sap_module: string | null
          shortcut: string | null
          title: string
          updated_at: string
          usage_count: number | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          sap_module?: string | null
          shortcut?: string | null
          title: string
          updated_at?: string
          usage_count?: number | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          sap_module?: string | null
          shortcut?: string | null
          title?: string
          updated_at?: string
          usage_count?: number | null
        }
        Relationships: []
      }
      catalog_items: {
        Row: {
          approval_roles: string[] | null
          category: string
          cost_currency: string | null
          created_at: string
          created_by: string | null
          description: string | null
          estimated_cost: number | null
          estimated_time: string | null
          form_schema: Json | null
          icon: string | null
          id: string
          is_active: boolean | null
          requires_approval: boolean | null
          sap_module: string | null
          sort_order: number | null
          tenant_id: string | null
          title: string
          updated_at: string
          usage_count: number | null
        }
        Insert: {
          approval_roles?: string[] | null
          category?: string
          cost_currency?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_cost?: number | null
          estimated_time?: string | null
          form_schema?: Json | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          requires_approval?: boolean | null
          sap_module?: string | null
          sort_order?: number | null
          tenant_id?: string | null
          title: string
          updated_at?: string
          usage_count?: number | null
        }
        Update: {
          approval_roles?: string[] | null
          category?: string
          cost_currency?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_cost?: number | null
          estimated_time?: string | null
          form_schema?: Json | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          requires_approval?: boolean | null
          sap_module?: string | null
          sort_order?: number | null
          tenant_id?: string | null
          title?: string
          updated_at?: string
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_requests: {
        Row: {
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          catalog_item_id: string
          created_at: string
          form_data: Json | null
          fulfilled_at: string | null
          id: string
          notes: string | null
          requested_by: string
          status: string
          tenant_id: string | null
          ticket_id: string | null
          updated_at: string
        }
        Insert: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          catalog_item_id: string
          created_at?: string
          form_data?: Json | null
          fulfilled_at?: string | null
          id?: string
          notes?: string | null
          requested_by: string
          status?: string
          tenant_id?: string | null
          ticket_id?: string | null
          updated_at?: string
        }
        Update: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          catalog_item_id?: string
          created_at?: string
          form_data?: Json | null
          fulfilled_at?: string | null
          id?: string
          notes?: string | null
          requested_by?: string
          status?: string
          tenant_id?: string | null
          ticket_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_requests_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_requests_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
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
      change_approvals: {
        Row: {
          approver_id: string
          change_request_id: string
          comments: string | null
          created_at: string
          decided_at: string | null
          decision: string
          id: string
        }
        Insert: {
          approver_id: string
          change_request_id: string
          comments?: string | null
          created_at?: string
          decided_at?: string | null
          decision?: string
          id?: string
        }
        Update: {
          approver_id?: string
          change_request_id?: string
          comments?: string | null
          created_at?: string
          decided_at?: string | null
          decision?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_approvals_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: false
            referencedRelation: "change_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      change_requests: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          affected_modules: string[] | null
          affected_services: string[] | null
          assigned_to: string | null
          cab_decision: string | null
          cab_decision_at: string | null
          cab_notes: string | null
          cab_required: boolean | null
          change_type: string
          created_at: string
          description: string | null
          id: string
          implementation_plan: string | null
          requested_by: string
          risk_level: string
          rollback_plan: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          status: string
          tenant_id: string | null
          ticket_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          affected_modules?: string[] | null
          affected_services?: string[] | null
          assigned_to?: string | null
          cab_decision?: string | null
          cab_decision_at?: string | null
          cab_notes?: string | null
          cab_required?: boolean | null
          change_type?: string
          created_at?: string
          description?: string | null
          id?: string
          implementation_plan?: string | null
          requested_by: string
          risk_level?: string
          rollback_plan?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          status?: string
          tenant_id?: string | null
          ticket_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          affected_modules?: string[] | null
          affected_services?: string[] | null
          assigned_to?: string | null
          cab_decision?: string | null
          cab_decision_at?: string | null
          cab_notes?: string | null
          cab_required?: boolean | null
          change_type?: string
          created_at?: string
          description?: string | null
          id?: string
          implementation_plan?: string | null
          requested_by?: string
          risk_level?: string
          rollback_plan?: string | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          status?: string
          tenant_id?: string | null
          ticket_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_requests_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
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
      client_approval_events: {
        Row: {
          actor_id: string | null
          client_user_id: string
          created_at: string
          event_type: string
          id: string
          note: string | null
        }
        Insert: {
          actor_id?: string | null
          client_user_id: string
          created_at?: string
          event_type: string
          id?: string
          note?: string | null
        }
        Update: {
          actor_id?: string | null
          client_user_id?: string
          created_at?: string
          event_type?: string
          id?: string
          note?: string | null
        }
        Relationships: []
      }
      client_plan_subscriptions: {
        Row: {
          base_monthly_price: number
          client_id: string
          created_at: string
          discount_amount: number
          final_monthly_price: number
          free_until: string | null
          id: string
          payment_id: string | null
          plan_id: string
          status: string
          tickets_per_month: number
          voucher_id: string | null
        }
        Insert: {
          base_monthly_price: number
          client_id: string
          created_at?: string
          discount_amount?: number
          final_monthly_price: number
          free_until?: string | null
          id?: string
          payment_id?: string | null
          plan_id: string
          status?: string
          tickets_per_month: number
          voucher_id?: string | null
        }
        Update: {
          base_monthly_price?: number
          client_id?: string
          created_at?: string
          discount_amount?: number
          final_monthly_price?: number
          free_until?: string | null
          id?: string
          payment_id?: string | null
          plan_id?: string
          status?: string
          tickets_per_month?: number
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_plan_subscriptions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_plan_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_plan_subscriptions_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      client_profiles: {
        Row: {
          approval_comment: string | null
          approval_reviewed_at: string | null
          approval_reviewed_by: string | null
          approval_status: string
          approval_submitted_at: string | null
          communication_preference: string | null
          company_description: string | null
          company_logo_url: string | null
          company_name: string | null
          company_size: string | null
          company_website: string | null
          created_at: string
          custom_nda_filename: string | null
          custom_nda_url: string | null
          headquarters: string | null
          id: string
          industry: string | null
          key_contacts: Json | null
          onboarding_completed: boolean | null
          phone: string | null
          preferred_language: string | null
          sap_custom_dev_count: number | null
          sap_database_type: string | null
          sap_go_live_date: string | null
          sap_hosting_type: string | null
          sap_interfaces: string[] | null
          sap_landscape: string | null
          sap_landscape_notes: string | null
          sap_module_versions: Json | null
          sap_modules: string[] | null
          sap_os_type: string | null
          sap_product: string | null
          sap_support_pack: string | null
          sap_system_ids: string[] | null
          sap_third_party_tools: string[] | null
          sap_user_count: number | null
          sap_version: string | null
          timezone: string | null
          updated_at: string
          use_custom_nda: boolean
          user_id: string
        }
        Insert: {
          approval_comment?: string | null
          approval_reviewed_at?: string | null
          approval_reviewed_by?: string | null
          approval_status?: string
          approval_submitted_at?: string | null
          communication_preference?: string | null
          company_description?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          company_size?: string | null
          company_website?: string | null
          created_at?: string
          custom_nda_filename?: string | null
          custom_nda_url?: string | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          key_contacts?: Json | null
          onboarding_completed?: boolean | null
          phone?: string | null
          preferred_language?: string | null
          sap_custom_dev_count?: number | null
          sap_database_type?: string | null
          sap_go_live_date?: string | null
          sap_hosting_type?: string | null
          sap_interfaces?: string[] | null
          sap_landscape?: string | null
          sap_landscape_notes?: string | null
          sap_module_versions?: Json | null
          sap_modules?: string[] | null
          sap_os_type?: string | null
          sap_product?: string | null
          sap_support_pack?: string | null
          sap_system_ids?: string[] | null
          sap_third_party_tools?: string[] | null
          sap_user_count?: number | null
          sap_version?: string | null
          timezone?: string | null
          updated_at?: string
          use_custom_nda?: boolean
          user_id: string
        }
        Update: {
          approval_comment?: string | null
          approval_reviewed_at?: string | null
          approval_reviewed_by?: string | null
          approval_status?: string
          approval_submitted_at?: string | null
          communication_preference?: string | null
          company_description?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          company_size?: string | null
          company_website?: string | null
          created_at?: string
          custom_nda_filename?: string | null
          custom_nda_url?: string | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          key_contacts?: Json | null
          onboarding_completed?: boolean | null
          phone?: string | null
          preferred_language?: string | null
          sap_custom_dev_count?: number | null
          sap_database_type?: string | null
          sap_go_live_date?: string | null
          sap_hosting_type?: string | null
          sap_interfaces?: string[] | null
          sap_landscape?: string | null
          sap_landscape_notes?: string | null
          sap_module_versions?: Json | null
          sap_modules?: string[] | null
          sap_os_type?: string | null
          sap_product?: string | null
          sap_support_pack?: string | null
          sap_system_ids?: string[] | null
          sap_third_party_tools?: string[] | null
          sap_user_count?: number | null
          sap_version?: string | null
          timezone?: string | null
          updated_at?: string
          use_custom_nda?: boolean
          user_id?: string
        }
        Relationships: []
      }
      client_testimonials: {
        Row: {
          accent: string
          company: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          is_featured: boolean
          logo_url: string | null
          name: string
          published_at: string | null
          published_by: string | null
          quote: string
          rating: number
          rejected_reason: string | null
          role: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          accent?: string
          company: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_featured?: boolean
          logo_url?: string | null
          name: string
          published_at?: string | null
          published_by?: string | null
          quote: string
          rating?: number
          rejected_reason?: string | null
          role: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          accent?: string
          company?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_featured?: boolean
          logo_url?: string | null
          name?: string
          published_at?: string | null
          published_by?: string | null
          quote?: string
          rating?: number
          rejected_reason?: string | null
          role?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      consultant_cv_profiles: {
        Row: {
          consultant_id: string
          cv_text: string | null
          expertise_keywords: string[]
          matching_summary: string | null
          parsed_at: string
          source_path: string | null
        }
        Insert: {
          consultant_id: string
          cv_text?: string | null
          expertise_keywords?: string[]
          matching_summary?: string | null
          parsed_at?: string
          source_path?: string | null
        }
        Update: {
          consultant_id?: string
          cv_text?: string | null
          expertise_keywords?: string[]
          matching_summary?: string | null
          parsed_at?: string
          source_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_cv_profiles_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
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
      consultant_payout_details: {
        Row: {
          account_holder: string
          account_number: string | null
          bank_name: string
          consultant_id: string
          country: string | null
          created_at: string
          currency: string
          iban: string | null
          notes: string | null
          swift_bic: string | null
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          account_holder: string
          account_number?: string | null
          bank_name: string
          consultant_id: string
          country?: string | null
          created_at?: string
          currency?: string
          iban?: string | null
          notes?: string | null
          swift_bic?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          account_holder?: string
          account_number?: string | null
          bank_name?: string
          consultant_id?: string
          country?: string | null
          created_at?: string
          currency?: string
          iban?: string | null
          notes?: string | null
          swift_bic?: string | null
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_payout_details_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: true
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
      consultant_verification_audit: {
        Row: {
          consultant_id: string
          created_at: string
          id: string
          new_status: Database["public"]["Enums"]["verification_status"]
          old_status: Database["public"]["Enums"]["verification_status"] | null
          reason: string | null
          reviewer_id: string | null
        }
        Insert: {
          consultant_id: string
          created_at?: string
          id?: string
          new_status: Database["public"]["Enums"]["verification_status"]
          old_status?: Database["public"]["Enums"]["verification_status"] | null
          reason?: string | null
          reviewer_id?: string | null
        }
        Update: {
          consultant_id?: string
          created_at?: string
          id?: string
          new_status?: Database["public"]["Enums"]["verification_status"]
          old_status?: Database["public"]["Enums"]["verification_status"] | null
          reason?: string | null
          reviewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultant_verification_audit_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      consultant_verification_items: {
        Row: {
          completed_at: string | null
          consultant_id: string
          consultant_note: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          kind: string
          label: string
          reminder_sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          consultant_id: string
          consultant_note?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string
          id?: string
          kind?: string
          label: string
          reminder_sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          consultant_id?: string
          consultant_note?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string
          id?: string
          kind?: string
          label?: string
          reminder_sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultant_verification_items_consultant_id_fkey"
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
          ai_interview_badge: string | null
          ai_interview_completed_at: string | null
          ai_skills_score: number | null
          availability_status:
            | Database["public"]["Enums"]["availability_status"]
            | null
          bio: string | null
          city: string | null
          country: string | null
          created_at: string
          credibility_credits: number
          credly_checked_at: string | null
          credly_username: string | null
          currency: string | null
          cv_url: string | null
          github_url: string | null
          hourly_rate: number | null
          id: string
          industries: string[] | null
          languages: string[] | null
          latitude: number | null
          linkedin_checked_at: string | null
          linkedin_url: string | null
          localization_countries: string[]
          location: unknown
          longitude: number | null
          nationality: string | null
          personal_website: string | null
          profile_video_url: string | null
          project_types: string[]
          rating: number | null
          response_time_minutes: number | null
          sap_role: string | null
          sap_roles: string[]
          sap_technologies: string[]
          seniority_level: string | null
          timezone: string | null
          total_reviews: number | null
          total_sap_years: number | null
          updated_at: string
          user_id: string
          verification_status:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Insert: {
          ai_interview_badge?: string | null
          ai_interview_completed_at?: string | null
          ai_skills_score?: number | null
          availability_status?:
            | Database["public"]["Enums"]["availability_status"]
            | null
          bio?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          credibility_credits?: number
          credly_checked_at?: string | null
          credly_username?: string | null
          currency?: string | null
          cv_url?: string | null
          github_url?: string | null
          hourly_rate?: number | null
          id?: string
          industries?: string[] | null
          languages?: string[] | null
          latitude?: number | null
          linkedin_checked_at?: string | null
          linkedin_url?: string | null
          localization_countries?: string[]
          location?: unknown
          longitude?: number | null
          nationality?: string | null
          personal_website?: string | null
          profile_video_url?: string | null
          project_types?: string[]
          rating?: number | null
          response_time_minutes?: number | null
          sap_role?: string | null
          sap_roles?: string[]
          sap_technologies?: string[]
          seniority_level?: string | null
          timezone?: string | null
          total_reviews?: number | null
          total_sap_years?: number | null
          updated_at?: string
          user_id: string
          verification_status?:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Update: {
          ai_interview_badge?: string | null
          ai_interview_completed_at?: string | null
          ai_skills_score?: number | null
          availability_status?:
            | Database["public"]["Enums"]["availability_status"]
            | null
          bio?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          credibility_credits?: number
          credly_checked_at?: string | null
          credly_username?: string | null
          currency?: string | null
          cv_url?: string | null
          github_url?: string | null
          hourly_rate?: number | null
          id?: string
          industries?: string[] | null
          languages?: string[] | null
          latitude?: number | null
          linkedin_checked_at?: string | null
          linkedin_url?: string | null
          localization_countries?: string[]
          location?: unknown
          longitude?: number | null
          nationality?: string | null
          personal_website?: string | null
          profile_video_url?: string | null
          project_types?: string[]
          rating?: number | null
          response_time_minutes?: number | null
          sap_role?: string | null
          sap_roles?: string[]
          sap_technologies?: string[]
          seniority_level?: string | null
          timezone?: string | null
          total_reviews?: number | null
          total_sap_years?: number | null
          updated_at?: string
          user_id?: string
          verification_status?:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Relationships: []
      }
      demo_requests: {
        Row: {
          company: string | null
          created_at: string
          demo_type: string
          email: string
          full_name: string
          id: string
          meeting_format: string | null
          notes: string | null
          proposed_slots: Json | null
          request_token: string
          reschedule_reason: string | null
          reschedule_requested_at: string | null
          scheduled_date: string | null
          scheduled_slot: string | null
          scheduling_preference: string
          source: string | null
          status: string
          status_note: string | null
          timezone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          demo_type: string
          email: string
          full_name: string
          id?: string
          meeting_format?: string | null
          notes?: string | null
          proposed_slots?: Json | null
          request_token?: string
          reschedule_reason?: string | null
          reschedule_requested_at?: string | null
          scheduled_date?: string | null
          scheduled_slot?: string | null
          scheduling_preference: string
          source?: string | null
          status?: string
          status_note?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string
          demo_type?: string
          email?: string
          full_name?: string
          id?: string
          meeting_format?: string | null
          notes?: string | null
          proposed_slots?: Json | null
          request_token?: string
          reschedule_reason?: string | null
          reschedule_requested_at?: string | null
          scheduled_date?: string | null
          scheduled_slot?: string | null
          scheduling_preference?: string
          source?: string | null
          status?: string
          status_note?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
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
      environment_consultants: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          consultant_id: string
          environment_id: string
          id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          consultant_id: string
          environment_id: string
          id?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          consultant_id?: string
          environment_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "environment_consultants_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "environment_consultants_environment_id_fkey"
            columns: ["environment_id"]
            isOneToOne: false
            referencedRelation: "remote_environments"
            referencedColumns: ["id"]
          },
        ]
      }
      environment_credentials: {
        Row: {
          created_at: string
          credential_label: string
          domain: string | null
          entered_by: string
          environment_id: string
          hostname: string | null
          id: string
          password_ciphertext: string | null
          password_encrypted: string
          port: number | null
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          credential_label?: string
          domain?: string | null
          entered_by: string
          environment_id: string
          hostname?: string | null
          id?: string
          password_ciphertext?: string | null
          password_encrypted: string
          port?: number | null
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          credential_label?: string
          domain?: string | null
          entered_by?: string
          environment_id?: string
          hostname?: string | null
          id?: string
          password_ciphertext?: string | null
          password_encrypted?: string
          port?: number | null
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "environment_credentials_environment_id_fkey"
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
      error_reports: {
        Row: {
          context: Json | null
          created_at: string
          fingerprint: string | null
          id: string
          level: string
          message: string
          occurrence_count: number
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          resolved_notes: string | null
          route: string | null
          source: string
          stack: string | null
          updated_at: string
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          fingerprint?: string | null
          id?: string
          level?: string
          message: string
          occurrence_count?: number
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_notes?: string | null
          route?: string | null
          source?: string
          stack?: string | null
          updated_at?: string
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          fingerprint?: string | null
          id?: string
          level?: string
          message?: string
          occurrence_count?: number
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_notes?: string | null
          route?: string | null
          source?: string
          stack?: string | null
          updated_at?: string
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
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
            foreignKeyName: "integration_sync_log_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations_safe"
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
          api_key_ciphertext: string | null
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
          tenant_id: string | null
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          api_key_ciphertext?: string | null
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
          tenant_id?: string | null
          updated_at?: string
          webhook_secret?: string
        }
        Update: {
          api_key_ciphertext?: string | null
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
          tenant_id?: string | null
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          sap_module: string | null
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
          sap_module?: string | null
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
          sap_module?: string | null
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
      interview_invitations: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          responded_at: string | null
          sent_at: string | null
          session_id: string
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          responded_at?: string | null
          sent_at?: string | null
          session_id: string
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          responded_at?: string | null
          sent_at?: string | null
          session_id?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_invitations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          is_private: boolean
          sender_id: string
          sender_name: string | null
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_private?: boolean
          sender_id: string
          sender_name?: string | null
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_private?: boolean
          sender_id?: string
          sender_name?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_participants: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          proposed_slots: Json | null
          role: string
          rsvp_at: string | null
          rsvp_note: string | null
          rsvp_status: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          proposed_slots?: Json | null
          role?: string
          rsvp_at?: string | null
          rsvp_note?: string | null
          rsvp_status?: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          proposed_slots?: Json | null
          role?: string
          rsvp_at?: string | null
          rsvp_note?: string | null
          rsvp_status?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "interview_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_question_library: {
        Row: {
          author_name: string | null
          best_answer: string
          category: string | null
          created_at: string
          created_by: string | null
          difficulty: string
          id: string
          is_active: boolean
          key_points: string | null
          question: string
          sap_module: string
          source: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          best_answer?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          difficulty?: string
          id?: string
          is_active?: boolean
          key_points?: string | null
          question: string
          sap_module?: string
          source?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          best_answer?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          difficulty?: string
          id?: string
          is_active?: boolean
          key_points?: string | null
          question?: string
          sap_module?: string
          source?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      interview_sessions: {
        Row: {
          ai_summary: string | null
          completed_at: string | null
          consultant_id: string
          created_at: string
          duration_minutes: number
          id: string
          interview_style: string
          interview_type: Database["public"]["Enums"]["interview_mode"] | null
          meeting_url: string | null
          overall_score: number | null
          requested_by: string | null
          scheduled_at: string | null
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
          duration_minutes?: number
          id?: string
          interview_style?: string
          interview_type?: Database["public"]["Enums"]["interview_mode"] | null
          meeting_url?: string | null
          overall_score?: number | null
          requested_by?: string | null
          scheduled_at?: string | null
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
          duration_minutes?: number
          id?: string
          interview_style?: string
          interview_type?: Database["public"]["Enums"]["interview_mode"] | null
          meeting_url?: string | null
          overall_score?: number | null
          requested_by?: string | null
          scheduled_at?: string | null
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
      interview_templates: {
        Row: {
          created_at: string
          created_by: string | null
          focus_areas: string
          id: string
          instructions: string
          is_active: boolean
          question_count: number
          role_focus: string
          sample_questions: string
          sap_module: string
          seniority: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          focus_areas?: string
          id?: string
          instructions?: string
          is_active?: boolean
          question_count?: number
          role_focus?: string
          sample_questions?: string
          sap_module: string
          seniority?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          focus_areas?: string
          id?: string
          instructions?: string
          is_active?: boolean
          question_count?: number
          role_focus?: string
          sample_questions?: string
          sap_module?: string
          seniority?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      interview_training_config: {
        Row: {
          created_at: string
          created_by: string | null
          custom_questions: Json
          difficulty_level: string
          id: string
          is_active: boolean
          sap_module: string
          training_instructions: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          custom_questions?: Json
          difficulty_level?: string
          id?: string
          is_active?: boolean
          sap_module?: string
          training_instructions?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          custom_questions?: Json
          difficulty_level?: string
          id?: string
          is_active?: boolean
          sap_module?: string
          training_instructions?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      invoice_disputes: {
        Row: {
          client_id: string
          consultant_id: string | null
          created_at: string
          description: string
          evidence_urls: Json
          id: string
          payment_id: string
          reason_category: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          client_id: string
          consultant_id?: string | null
          created_at?: string
          description: string
          evidence_urls?: Json
          id?: string
          payment_id: string
          reason_category: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          consultant_id?: string | null
          created_at?: string
          description?: string
          evidence_urls?: Json
          id?: string
          payment_id?: string
          reason_category?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          title?: string
          updated_at?: string
          views_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_articles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_solution_meta: {
        Row: {
          created_at: string
          origin_kind: string
          privacy_flags: string[]
          reviewed_at: string | null
          reviewed_by: string | null
          solution_id: string
          source_consultant_id: string | null
          source_ticket_id: string | null
        }
        Insert: {
          created_at?: string
          origin_kind: string
          privacy_flags?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          solution_id: string
          source_consultant_id?: string | null
          source_ticket_id?: string | null
        }
        Update: {
          created_at?: string
          origin_kind?: string
          privacy_flags?: string[]
          reviewed_at?: string | null
          reviewed_by?: string | null
          solution_id?: string
          source_consultant_id?: string | null
          source_ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_solution_meta_solution_id_fkey"
            columns: ["solution_id"]
            isOneToOne: true
            referencedRelation: "knowledge_solutions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_solution_meta_source_consultant_id_fkey"
            columns: ["source_consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_solution_meta_source_ticket_id_fkey"
            columns: ["source_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_solutions: {
        Row: {
          created_at: string
          created_by: string | null
          helpful_count: number | null
          id: string
          problem_description: string | null
          sap_module: string | null
          sap_modules: string[]
          solution: string | null
          source_ticket_id: string | null
          status: string
          tags: string[] | null
          tenant_id: string | null
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
          sap_modules?: string[]
          solution?: string | null
          source_ticket_id?: string | null
          status?: string
          tags?: string[] | null
          tenant_id?: string | null
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
          sap_modules?: string[]
          solution?: string | null
          source_ticket_id?: string | null
          status?: string
          tags?: string[] | null
          tenant_id?: string | null
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
          {
            foreignKeyName: "knowledge_solutions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_content: {
        Row: {
          content: Json
          created_at: string
          id: string
          is_active: boolean
          section_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          section_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          section_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      logo_upload_attempts: {
        Row: {
          bucket: string
          created_at: string
          error_code: string | null
          error_message: string | null
          file_name: string | null
          file_size: number | null
          file_type: string | null
          id: string
          path: string
          success: boolean
          user_agent: string | null
          user_id: string
        }
        Insert: {
          bucket: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          path: string
          success?: boolean
          user_agent?: string | null
          user_id: string
        }
        Update: {
          bucket?: string
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          file_name?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          path?: string
          success?: boolean
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      major_incident_updates: {
        Row: {
          content: string
          created_at: string
          id: string
          is_public: boolean | null
          major_incident_id: string
          posted_by: string
          update_type: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_public?: boolean | null
          major_incident_id: string
          posted_by: string
          update_type?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_public?: boolean | null
          major_incident_id?: string
          posted_by?: string
          update_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "major_incident_updates_major_incident_id_fkey"
            columns: ["major_incident_id"]
            isOneToOne: false
            referencedRelation: "major_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      major_incidents: {
        Row: {
          action_items: Json | null
          affected_services: string[] | null
          affected_users_count: number | null
          business_impact: string | null
          communication_lead_id: string | null
          created_at: string
          created_by: string
          declared_at: string | null
          description: string | null
          id: string
          incident_commander_id: string | null
          lessons_learned: string | null
          mitigated_at: string | null
          pir_completed_at: string | null
          pir_notes: string | null
          pir_scheduled_at: string | null
          resolution_summary: string | null
          resolved_at: string | null
          root_cause: string | null
          severity: string
          status: string
          tenant_id: string | null
          ticket_id: string | null
          timeline_summary: string | null
          title: string
          updated_at: string
          war_room_link: string | null
        }
        Insert: {
          action_items?: Json | null
          affected_services?: string[] | null
          affected_users_count?: number | null
          business_impact?: string | null
          communication_lead_id?: string | null
          created_at?: string
          created_by: string
          declared_at?: string | null
          description?: string | null
          id?: string
          incident_commander_id?: string | null
          lessons_learned?: string | null
          mitigated_at?: string | null
          pir_completed_at?: string | null
          pir_notes?: string | null
          pir_scheduled_at?: string | null
          resolution_summary?: string | null
          resolved_at?: string | null
          root_cause?: string | null
          severity?: string
          status?: string
          tenant_id?: string | null
          ticket_id?: string | null
          timeline_summary?: string | null
          title: string
          updated_at?: string
          war_room_link?: string | null
        }
        Update: {
          action_items?: Json | null
          affected_services?: string[] | null
          affected_users_count?: number | null
          business_impact?: string | null
          communication_lead_id?: string | null
          created_at?: string
          created_by?: string
          declared_at?: string | null
          description?: string | null
          id?: string
          incident_commander_id?: string | null
          lessons_learned?: string | null
          mitigated_at?: string | null
          pir_completed_at?: string | null
          pir_notes?: string | null
          pir_scheduled_at?: string | null
          resolution_summary?: string | null
          resolved_at?: string | null
          root_cause?: string | null
          severity?: string
          status?: string
          tenant_id?: string | null
          ticket_id?: string | null
          timeline_summary?: string | null
          title?: string
          updated_at?: string
          war_room_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "major_incidents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "major_incidents_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_join_events: {
        Row: {
          created_at: string
          event: string
          id: string
          metadata: Json
          provider: string
          reason: string | null
          session_id: string | null
          url_host: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          metadata?: Json
          provider?: string
          reason?: string | null
          session_id?: string | null
          url_host?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          metadata?: Json
          provider?: string
          reason?: string | null
          session_id?: string | null
          url_host?: string | null
          user_agent?: string | null
          user_id?: string
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
      milestones: {
        Row: {
          amount: number
          approved_at: string | null
          created_at: string
          currency: string | null
          description: string | null
          due_date: string | null
          escrow_status: Database["public"]["Enums"]["escrow_status"]
          funded_at: string | null
          id: string
          position: number
          project_id: string
          released_at: string | null
          submitted_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          amount?: number
          approved_at?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          due_date?: string | null
          escrow_status?: Database["public"]["Enums"]["escrow_status"]
          funded_at?: string | null
          id?: string
          position?: number
          project_id: string
          released_at?: string | null
          submitted_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          due_date?: string | null
          escrow_status?: Database["public"]["Enums"]["escrow_status"]
          funded_at?: string | null
          id?: string
          position?: number
          project_id?: string
          released_at?: string | null
          submitted_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      nda_agreements: {
        Row: {
          client_id: string
          client_signature_data: string | null
          client_signature_type: string | null
          client_signed_at: string | null
          client_signer_name: string | null
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
          client_signature_data?: string | null
          client_signature_type?: string | null
          client_signed_at?: string | null
          client_signer_name?: string | null
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
          client_signature_data?: string | null
          client_signature_type?: string | null
          client_signed_at?: string | null
          client_signer_name?: string | null
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
          delivery_error: string | null
          delivery_status: string
          id: string
          is_read: boolean | null
          last_attempt_at: string
          link: string | null
          retry_count: number
          tenant_id: string | null
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          delivery_error?: string | null
          delivery_status?: string
          id?: string
          is_read?: boolean | null
          last_attempt_at?: string
          link?: string | null
          retry_count?: number
          tenant_id?: string | null
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          delivery_error?: string | null
          delivery_status?: string
          id?: string
          is_read?: boolean | null
          last_attempt_at?: string
          link?: string | null
          retry_count?: number
          tenant_id?: string | null
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      oncall_rotations: {
        Row: {
          consultant_id: string
          created_at: string
          end_date: string
          id: string
          is_override: boolean | null
          override_reason: string | null
          schedule_id: string
          start_date: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          end_date: string
          id?: string
          is_override?: boolean | null
          override_reason?: string | null
          schedule_id: string
          start_date: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          end_date?: string
          id?: string
          is_override?: boolean | null
          override_reason?: string | null
          schedule_id?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "oncall_rotations_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oncall_rotations_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "oncall_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      oncall_schedules: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          rotation_type: string
          sap_module: string | null
          tenant_id: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          rotation_type?: string
          sap_module?: string | null
          tenant_id?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          rotation_type?: string
          sap_module?: string | null
          tenant_id?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "oncall_schedules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_card_attempts: {
        Row: {
          created_at: string
          id: string
          payment_id: string
          provider: string
          provider_intention_id: string | null
          provider_order_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payment_id: string
          provider: string
          provider_intention_id?: string | null
          provider_order_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payment_id?: string
          provider?: string
          provider_intention_id?: string | null
          provider_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_card_attempts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_provider_events: {
        Row: {
          amount: number | null
          created_at: string
          currency: string | null
          delivered_via: string
          detail: string | null
          event_key: string
          id: string
          kind: string
          order_id: string | null
          outcome: string | null
          payload: Json
          payment_id: string | null
          provider: string
          transaction_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          delivered_via?: string
          detail?: string | null
          event_key: string
          id?: string
          kind: string
          order_id?: string | null
          outcome?: string | null
          payload?: Json
          payment_id?: string | null
          provider: string
          transaction_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string | null
          delivered_via?: string
          detail?: string | null
          event_key?: string
          id?: string
          kind?: string
          order_id?: string | null
          outcome?: string | null
          payload?: Json
          payment_id?: string | null
          provider?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_provider_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          bank_reference: string | null
          base_amount: number | null
          card_started_at: string | null
          client_id: string
          client_note: string | null
          client_reported_at: string | null
          client_transfer_date: string | null
          client_transfer_reference: string | null
          confirmed_by: string | null
          consultant_id: string | null
          created_at: string
          currency: string | null
          description: string | null
          due_date: string | null
          id: string
          invoice_number: string | null
          kind: string
          milestone_id: string | null
          paid_at: string | null
          payment_method: string | null
          pricing_model: string
          processing_fee_amount: number | null
          processing_fee_percent: number | null
          provider: string
          provider_status: string | null
          provider_transaction_id: string | null
          received_amount: number | null
          reference: string | null
          rejection_note: string | null
          service_fee_amount: number | null
          service_fee_percent: number | null
          session_id: string | null
          status: Database["public"]["Enums"]["payment_status"] | null
          stripe_payment_id: string | null
          tenant_id: string | null
          ticket_id: string | null
          timesheet_id: string | null
          updated_at: string
          vat_amount: number | null
          vat_percent: number | null
        }
        Insert: {
          amount: number
          bank_reference?: string | null
          base_amount?: number | null
          card_started_at?: string | null
          client_id: string
          client_note?: string | null
          client_reported_at?: string | null
          client_transfer_date?: string | null
          client_transfer_reference?: string | null
          confirmed_by?: string | null
          consultant_id?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          kind?: string
          milestone_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          pricing_model?: string
          processing_fee_amount?: number | null
          processing_fee_percent?: number | null
          provider?: string
          provider_status?: string | null
          provider_transaction_id?: string | null
          received_amount?: number | null
          reference?: string | null
          rejection_note?: string | null
          service_fee_amount?: number | null
          service_fee_percent?: number | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          stripe_payment_id?: string | null
          tenant_id?: string | null
          ticket_id?: string | null
          timesheet_id?: string | null
          updated_at?: string
          vat_amount?: number | null
          vat_percent?: number | null
        }
        Update: {
          amount?: number
          bank_reference?: string | null
          base_amount?: number | null
          card_started_at?: string | null
          client_id?: string
          client_note?: string | null
          client_reported_at?: string | null
          client_transfer_date?: string | null
          client_transfer_reference?: string | null
          confirmed_by?: string | null
          consultant_id?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          kind?: string
          milestone_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          pricing_model?: string
          processing_fee_amount?: number | null
          processing_fee_percent?: number | null
          provider?: string
          provider_status?: string | null
          provider_transaction_id?: string | null
          received_amount?: number | null
          reference?: string | null
          rejection_note?: string | null
          service_fee_amount?: number | null
          service_fee_percent?: number | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          stripe_payment_id?: string | null
          tenant_id?: string | null
          ticket_id?: string | null
          timesheet_id?: string | null
          updated_at?: string
          vat_amount?: number | null
          vat_percent?: number | null
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
            foreignKeyName: "payments_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_timesheet_id_fkey"
            columns: ["timesheet_id"]
            isOneToOne: false
            referencedRelation: "ticket_timesheet_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      payouts: {
        Row: {
          amount: number
          bank_reference: string | null
          commission_amount: number | null
          commission_percent: number | null
          consultant_id: string
          created_at: string
          currency: string | null
          gross_amount: number | null
          id: string
          milestone_id: string | null
          note: string | null
          paid_at: string | null
          payment_id: string | null
          payout_method: string | null
          processed_by: string | null
          reference: string | null
          status: Database["public"]["Enums"]["payout_status"] | null
          updated_at: string
        }
        Insert: {
          amount: number
          bank_reference?: string | null
          commission_amount?: number | null
          commission_percent?: number | null
          consultant_id: string
          created_at?: string
          currency?: string | null
          gross_amount?: number | null
          id?: string
          milestone_id?: string | null
          note?: string | null
          paid_at?: string | null
          payment_id?: string | null
          payout_method?: string | null
          processed_by?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["payout_status"] | null
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_reference?: string | null
          commission_amount?: number | null
          commission_percent?: number | null
          consultant_id?: string
          created_at?: string
          currency?: string | null
          gross_amount?: number | null
          id?: string
          milestone_id?: string | null
          note?: string | null
          paid_at?: string | null
          payment_id?: string | null
          payout_method?: string | null
          processed_by?: string | null
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
          {
            foreignKeyName: "payouts_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payouts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
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
      playbook_executions: {
        Row: {
          completed_at: string | null
          created_at: string
          current_step: number | null
          executed_by: string
          id: string
          playbook_id: string
          started_at: string | null
          status: string
          step_results: Json | null
          ticket_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_step?: number | null
          executed_by: string
          id?: string
          playbook_id: string
          started_at?: string | null
          status?: string
          step_results?: Json | null
          ticket_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_step?: number | null
          executed_by?: string
          id?: string
          playbook_id?: string
          started_at?: string | null
          status?: string
          step_results?: Json | null
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playbook_executions_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playbook_executions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      playbooks: {
        Row: {
          avg_completion_minutes: number | null
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          sap_module: string | null
          source_ticket_id: string | null
          steps: Json
          tenant_id: string | null
          title: string
          trigger_conditions: Json | null
          updated_at: string
          usage_count: number | null
        }
        Insert: {
          avg_completion_minutes?: number | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          sap_module?: string | null
          source_ticket_id?: string | null
          steps?: Json
          tenant_id?: string | null
          title: string
          trigger_conditions?: Json | null
          updated_at?: string
          usage_count?: number | null
        }
        Update: {
          avg_completion_minutes?: number | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          sap_module?: string | null
          source_ticket_id?: string | null
          steps?: Json
          tenant_id?: string | null
          title?: string
          trigger_conditions?: Json | null
          updated_at?: string
          usage_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "playbooks_source_ticket_id_fkey"
            columns: ["source_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playbooks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prediction_logs: {
        Row: {
          accepted: boolean | null
          confidence: number | null
          created_at: string
          feedback: string | null
          id: string
          model_used: string | null
          predicted_value: Json
          prediction_type: string
          ticket_id: string | null
        }
        Insert: {
          accepted?: boolean | null
          confidence?: number | null
          created_at?: string
          feedback?: string | null
          id?: string
          model_used?: string | null
          predicted_value: Json
          prediction_type: string
          ticket_id?: string | null
        }
        Update: {
          accepted?: boolean | null
          confidence?: number | null
          created_at?: string
          feedback?: string | null
          id?: string
          model_used?: string | null
          predicted_value?: Json
          prediction_type?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prediction_logs_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_incidents: {
        Row: {
          created_at: string
          id: string
          linked_by: string | null
          problem_id: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          linked_by?: string | null
          problem_id: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          linked_by?: string | null
          problem_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_incidents_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_incidents_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      problems: {
        Row: {
          affected_services: string[] | null
          assigned_to: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          incident_count: number | null
          is_known_error: boolean | null
          priority: string
          resolution: string | null
          resolved_at: string | null
          root_cause: string | null
          sap_module: string | null
          status: string
          tenant_id: string | null
          title: string
          updated_at: string
          workaround: string | null
        }
        Insert: {
          affected_services?: string[] | null
          assigned_to?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          incident_count?: number | null
          is_known_error?: boolean | null
          priority?: string
          resolution?: string | null
          resolved_at?: string | null
          root_cause?: string | null
          sap_module?: string | null
          status?: string
          tenant_id?: string | null
          title: string
          updated_at?: string
          workaround?: string | null
        }
        Update: {
          affected_services?: string[] | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          incident_count?: number | null
          is_known_error?: boolean | null
          priority?: string
          resolution?: string | null
          resolved_at?: string | null
          root_cause?: string | null
          sap_module?: string | null
          status?: string
          tenant_id?: string | null
          title?: string
          updated_at?: string
          workaround?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "problems_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          mime_type: string | null
          proposal_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          proposal_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          proposal_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_attachments_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          client_notes: string | null
          consultant_id: string
          cover_letter: string | null
          created_at: string
          estimated_hours: number | null
          id: string
          parent_proposal_id: string | null
          proposed_rate: number
          status: Database["public"]["Enums"]["proposal_status"]
          ticket_id: string
          timeline_days: number | null
          updated_at: string
          version: number
        }
        Insert: {
          client_notes?: string | null
          consultant_id: string
          cover_letter?: string | null
          created_at?: string
          estimated_hours?: number | null
          id?: string
          parent_proposal_id?: string | null
          proposed_rate?: number
          status?: Database["public"]["Enums"]["proposal_status"]
          ticket_id: string
          timeline_days?: number | null
          updated_at?: string
          version?: number
        }
        Update: {
          client_notes?: string | null
          consultant_id?: string
          cover_letter?: string | null
          created_at?: string
          estimated_hours?: number | null
          id?: string
          parent_proposal_id?: string | null
          proposed_rate?: number
          status?: Database["public"]["Enums"]["proposal_status"]
          ticket_id?: string
          timeline_days?: number | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "proposals_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_parent_proposal_id_fkey"
            columns: ["parent_proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_counters: {
        Row: {
          bucket: string
          hits: number
          window_start: string
        }
        Insert: {
          bucket: string
          hits?: number
          window_start: string
        }
        Update: {
          bucket?: string
          hits?: number
          window_start?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          client_id: string
          comment: string | null
          communication_score: number | null
          consultant_id: string
          created_at: string
          id: string
          is_anonymous: boolean
          responsiveness_score: number | null
          score: number
          session_id: string
          technical_expertise_score: number | null
        }
        Insert: {
          client_id: string
          comment?: string | null
          communication_score?: number | null
          consultant_id: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          responsiveness_score?: number | null
          score: number
          session_id: string
          technical_expertise_score?: number | null
        }
        Update: {
          client_id?: string
          comment?: string | null
          communication_score?: number | null
          consultant_id?: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          responsiveness_score?: number | null
          score?: number
          session_id?: string
          technical_expertise_score?: number | null
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
          access_type: string | null
          client_id: string
          consultant_id: string | null
          cpu_cores: number | null
          created_at: string
          description: string | null
          disk_gb: number | null
          environment_type: string | null
          guacamole_url: string
          id: string
          ip_address: string | null
          name: string
          notes: string | null
          os_type: string | null
          platform_type: string
          ram_gb: number | null
          region: string | null
          sap_client_number: string | null
          sap_sid: string | null
          status: Database["public"]["Enums"]["environment_status"]
          tenant_id: string | null
          ticket_id: string | null
          updated_at: string
          vm_name: string | null
          vmware_host: string | null
        }
        Insert: {
          access_type?: string | null
          client_id: string
          consultant_id?: string | null
          cpu_cores?: number | null
          created_at?: string
          description?: string | null
          disk_gb?: number | null
          environment_type?: string | null
          guacamole_url: string
          id?: string
          ip_address?: string | null
          name: string
          notes?: string | null
          os_type?: string | null
          platform_type?: string
          ram_gb?: number | null
          region?: string | null
          sap_client_number?: string | null
          sap_sid?: string | null
          status?: Database["public"]["Enums"]["environment_status"]
          tenant_id?: string | null
          ticket_id?: string | null
          updated_at?: string
          vm_name?: string | null
          vmware_host?: string | null
        }
        Update: {
          access_type?: string | null
          client_id?: string
          consultant_id?: string | null
          cpu_cores?: number | null
          created_at?: string
          description?: string | null
          disk_gb?: number | null
          environment_type?: string | null
          guacamole_url?: string
          id?: string
          ip_address?: string | null
          name?: string
          notes?: string | null
          os_type?: string | null
          platform_type?: string
          ram_gb?: number | null
          region?: string | null
          sap_client_number?: string | null
          sap_sid?: string | null
          status?: Database["public"]["Enums"]["environment_status"]
          tenant_id?: string | null
          ticket_id?: string | null
          updated_at?: string
          vm_name?: string | null
          vmware_host?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remote_environments_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remote_environments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remote_environments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      sap_doc_chunks: {
        Row: {
          body: string
          chunk_no: number
          doc_title: string
          heading: string | null
          id: string
          path: string
          source_id: string
          tsv: unknown
        }
        Insert: {
          body: string
          chunk_no: number
          doc_title: string
          heading?: string | null
          id?: string
          path: string
          source_id: string
          tsv?: unknown
        }
        Update: {
          body?: string
          chunk_no?: number
          doc_title?: string
          heading?: string | null
          id?: string
          path?: string
          source_id?: string
          tsv?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "sap_doc_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sap_doc_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sap_doc_files: {
        Row: {
          bytes: number
          done: boolean
          path: string
          source_id: string
        }
        Insert: {
          bytes?: number
          done?: boolean
          path: string
          source_id: string
        }
        Update: {
          bytes?: number
          done?: boolean
          path?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sap_doc_files_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sap_doc_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sap_doc_sources: {
        Row: {
          branch: string
          chunk_count: number
          commit_sha: string | null
          created_at: string
          enabled: boolean
          files_done: number
          files_total: number
          id: string
          imported_at: string | null
          last_error: string | null
          license: string
          repo: string
          status: string
          text_bytes: number
          title: string
          updated_at: string
        }
        Insert: {
          branch?: string
          chunk_count?: number
          commit_sha?: string | null
          created_at?: string
          enabled?: boolean
          files_done?: number
          files_total?: number
          id: string
          imported_at?: string | null
          last_error?: string | null
          license?: string
          repo: string
          status?: string
          text_bytes?: number
          title: string
          updated_at?: string
        }
        Update: {
          branch?: string
          chunk_count?: number
          commit_sha?: string | null
          created_at?: string
          enabled?: boolean
          files_done?: number
          files_total?: number
          id?: string
          imported_at?: string | null
          last_error?: string | null
          license?: string
          repo?: string
          status?: string
          text_bytes?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      satisfaction_surveys: {
        Row: {
          comment: string | null
          communication_score: number | null
          created_at: string
          id: string
          overall_score: number | null
          professionalism_score: number | null
          rated_by: string
          rated_user: string
          requested_by: string | null
          role: string
          session_id: string | null
          status: string
          technical_quality_score: number | null
          ticket_id: string | null
          timeliness_score: number | null
          updated_at: string
        }
        Insert: {
          comment?: string | null
          communication_score?: number | null
          created_at?: string
          id?: string
          overall_score?: number | null
          professionalism_score?: number | null
          rated_by: string
          rated_user: string
          requested_by?: string | null
          role: string
          session_id?: string | null
          status?: string
          technical_quality_score?: number | null
          ticket_id?: string | null
          timeliness_score?: number | null
          updated_at?: string
        }
        Update: {
          comment?: string | null
          communication_score?: number | null
          created_at?: string
          id?: string
          overall_score?: number | null
          professionalism_score?: number | null
          rated_by?: string
          rated_user?: string
          requested_by?: string | null
          role?: string
          session_id?: string | null
          status?: string
          technical_quality_score?: number | null
          ticket_id?: string | null
          timeliness_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "satisfaction_surveys_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "satisfaction_surveys_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
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
          calendar_event_id: string | null
          client_id: string
          consultant_id: string | null
          created_at: string
          duration_minutes: number | null
          ended_at: string | null
          id: string
          meeting_url: string | null
          notes: string | null
          recording_url: string | null
          reminder_minutes: number | null
          reminder_sent: boolean | null
          scheduled_at: string | null
          session_type: Database["public"]["Enums"]["session_type"] | null
          started_at: string | null
          status: Database["public"]["Enums"]["session_status"] | null
          tenant_id: string | null
          ticket_id: string | null
          updated_at: string
          video_platform: string | null
        }
        Insert: {
          ai_action_items?: string[] | null
          ai_summary?: string | null
          calendar_event_id?: string | null
          client_id: string
          consultant_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          meeting_url?: string | null
          notes?: string | null
          recording_url?: string | null
          reminder_minutes?: number | null
          reminder_sent?: boolean | null
          scheduled_at?: string | null
          session_type?: Database["public"]["Enums"]["session_type"] | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"] | null
          tenant_id?: string | null
          ticket_id?: string | null
          updated_at?: string
          video_platform?: string | null
        }
        Update: {
          ai_action_items?: string[] | null
          ai_summary?: string | null
          calendar_event_id?: string | null
          client_id?: string
          consultant_id?: string | null
          created_at?: string
          duration_minutes?: number | null
          ended_at?: string | null
          id?: string
          meeting_url?: string | null
          notes?: string | null
          recording_url?: string | null
          reminder_minutes?: number | null
          reminder_sent?: boolean | null
          scheduled_at?: string | null
          session_type?: Database["public"]["Enums"]["session_type"] | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["session_status"] | null
          tenant_id?: string | null
          ticket_id?: string | null
          updated_at?: string
          video_platform?: string | null
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
            foreignKeyName: "sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      shared_remote_configs: {
        Row: {
          accepted_at: string | null
          client_id: string
          config: Json
          consultant_id: string
          created_at: string
          id: string
          message: string | null
          revoked_at: string | null
          shared_at: string
          status: string
          tool_type: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          client_id: string
          config?: Json
          consultant_id: string
          created_at?: string
          id?: string
          message?: string | null
          revoked_at?: string | null
          shared_at?: string
          status?: string
          tool_type: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          client_id?: string
          config?: Json
          consultant_id?: string
          created_at?: string
          id?: string
          message?: string | null
          revoked_at?: string | null
          shared_at?: string
          status?: string
          tool_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_remote_configs_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          features: Json
          id: string
          is_active: boolean
          limits: Json
          name: string
          price_monthly: number
          price_yearly: number
          rate_discount_percent: number
          ticket_tiers: Json
          tickets_roll_over: boolean
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          limits?: Json
          name: string
          price_monthly?: number
          price_yearly?: number
          rate_discount_percent?: number
          ticket_tiers?: Json
          tickets_roll_over?: boolean
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          is_active?: boolean
          limits?: Json
          name?: string
          price_monthly?: number
          price_yearly?: number
          rate_discount_percent?: number
          ticket_tiers?: Json
          tickets_roll_over?: boolean
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
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
      tasks: {
        Row: {
          assignee_id: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          priority: Database["public"]["Enums"]["task_priority"]
          session_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          tags: string[] | null
          tenant_id: string | null
          ticket_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          session_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          tenant_id?: string | null
          ticket_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          session_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          tags?: string[] | null
          tenant_id?: string | null
          ticket_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string
          org_role: Database["public"]["Enums"]["org_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_role?: Database["public"]["Enums"]["org_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_role?: Database["public"]["Enums"]["org_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          ai_quota: number
          created_at: string
          created_by: string | null
          domain: string | null
          id: string
          logo_url: string | null
          max_sessions_per_month: number
          max_tickets_per_month: number
          max_users: number
          name: string
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          subscription_tier: Database["public"]["Enums"]["subscription_tier"]
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          ai_quota?: number
          created_at?: string
          created_by?: string | null
          domain?: string | null
          id?: string
          logo_url?: string | null
          max_sessions_per_month?: number
          max_tickets_per_month?: number
          max_users?: number
          name: string
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          ai_quota?: number
          created_at?: string
          created_by?: string | null
          domain?: string | null
          id?: string
          logo_url?: string | null
          max_sessions_per_month?: number
          max_tickets_per_month?: number
          max_users?: number
          name?: string
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ticket_assignments: {
        Row: {
          assigned_by: string | null
          consultant_id: string
          created_at: string
          id: string
          notes: string | null
          role: Database["public"]["Enums"]["assignment_role"]
          status: Database["public"]["Enums"]["assignment_status"]
          ticket_id: string
          updated_at: string
          work_mode: Database["public"]["Enums"]["assignment_work_mode"]
        }
        Insert: {
          assigned_by?: string | null
          consultant_id: string
          created_at?: string
          id?: string
          notes?: string | null
          role?: Database["public"]["Enums"]["assignment_role"]
          status?: Database["public"]["Enums"]["assignment_status"]
          ticket_id: string
          updated_at?: string
          work_mode?: Database["public"]["Enums"]["assignment_work_mode"]
        }
        Update: {
          assigned_by?: string | null
          consultant_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          role?: Database["public"]["Enums"]["assignment_role"]
          status?: Database["public"]["Enums"]["assignment_status"]
          ticket_id?: string
          updated_at?: string
          work_mode?: Database["public"]["Enums"]["assignment_work_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "ticket_assignments_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_assignments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_business_processes: {
        Row: {
          business_process_id: string
          created_at: string
          id: string
          linked_by: string
          ticket_id: string
        }
        Insert: {
          business_process_id: string
          created_at?: string
          id?: string
          linked_by: string
          ticket_id: string
        }
        Update: {
          business_process_id?: string
          created_at?: string
          id?: string
          linked_by?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_business_processes_business_process_id_fkey"
            columns: ["business_process_id"]
            isOneToOne: false
            referencedRelation: "business_processes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_business_processes_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_custom_field_definitions: {
        Row: {
          created_at: string
          created_by: string | null
          display_order: number | null
          field_label: string
          field_name: string
          field_type: string
          id: string
          is_active: boolean | null
          is_required: boolean | null
          options: Json | null
          placeholder: string | null
          sap_module: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_order?: number | null
          field_label: string
          field_name: string
          field_type?: string
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          options?: Json | null
          placeholder?: string | null
          sap_module?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_order?: number | null
          field_label?: string
          field_name?: string
          field_type?: string
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          options?: Json | null
          placeholder?: string | null
          sap_module?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ticket_custom_field_values: {
        Row: {
          created_at: string
          field_id: string
          id: string
          ticket_id: string
          updated_at: string
          value: string | null
        }
        Insert: {
          created_at?: string
          field_id: string
          id?: string
          ticket_id: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          created_at?: string
          field_id?: string
          id?: string
          ticket_id?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_custom_field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "ticket_custom_field_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_custom_field_values_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
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
      ticket_escalation_rules: {
        Row: {
          auto_change_urgency: string | null
          created_at: string
          created_by: string | null
          description: string | null
          escalate_to_role: string | null
          id: string
          is_active: boolean | null
          name: string
          notify_users: string[] | null
          sap_module_filter: string | null
          time_threshold_minutes: number | null
          trigger_condition: string
          updated_at: string
          urgency_filter: string | null
        }
        Insert: {
          auto_change_urgency?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          escalate_to_role?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notify_users?: string[] | null
          sap_module_filter?: string | null
          time_threshold_minutes?: number | null
          trigger_condition?: string
          updated_at?: string
          urgency_filter?: string | null
        }
        Update: {
          auto_change_urgency?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          escalate_to_role?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notify_users?: string[] | null
          sap_module_filter?: string | null
          time_threshold_minutes?: number | null
          trigger_condition?: string
          updated_at?: string
          urgency_filter?: string | null
        }
        Relationships: []
      }
      ticket_internal_notes: {
        Row: {
          author_id: string
          content: string
          created_at: string
          id: string
          is_pinned: boolean | null
          mentioned_users: string[] | null
          ticket_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          content: string
          created_at?: string
          id?: string
          is_pinned?: boolean | null
          mentioned_users?: string[] | null
          ticket_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: string
          created_at?: string
          id?: string
          is_pinned?: boolean | null
          mentioned_users?: string[] | null
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_internal_notes_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_interviews: {
        Row: {
          ai_summary: string | null
          body_language_analysis: Json | null
          client_id: string
          client_notes: string | null
          consultant_id: string
          consultant_notes: string | null
          created_at: string
          ended_at: string | null
          facial_verification_result: Json | null
          id: string
          interview_type: string
          overall_recommendation: string | null
          proposed_slots: Json | null
          recording_url: string | null
          room_id: string | null
          scheduled_at: string | null
          started_at: string | null
          status: string
          ticket_id: string
          transcript: string | null
          updated_at: string
        }
        Insert: {
          ai_summary?: string | null
          body_language_analysis?: Json | null
          client_id: string
          client_notes?: string | null
          consultant_id: string
          consultant_notes?: string | null
          created_at?: string
          ended_at?: string | null
          facial_verification_result?: Json | null
          id?: string
          interview_type?: string
          overall_recommendation?: string | null
          proposed_slots?: Json | null
          recording_url?: string | null
          room_id?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          ticket_id: string
          transcript?: string | null
          updated_at?: string
        }
        Update: {
          ai_summary?: string | null
          body_language_analysis?: Json | null
          client_id?: string
          client_notes?: string | null
          consultant_id?: string
          consultant_notes?: string | null
          created_at?: string
          ended_at?: string | null
          facial_verification_result?: Json | null
          id?: string
          interview_type?: string
          overall_recommendation?: string | null
          proposed_slots?: Json | null
          recording_url?: string | null
          room_id?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          ticket_id?: string
          transcript?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_interviews_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_interviews_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_invoices: {
        Row: {
          client_id: string
          consultant_id: string
          created_at: string
          currency: string
          decided_at: string | null
          id: string
          invoice_number: string
          lines: Json
          note: string | null
          payment_id: string | null
          rejection_reason: string | null
          status: string
          subtotal: number
          ticket_id: string
          timesheet_id: string | null
          total: number
          updated_at: string
          vat_amount: number
          vat_percent: number
        }
        Insert: {
          client_id: string
          consultant_id: string
          created_at?: string
          currency?: string
          decided_at?: string | null
          id?: string
          invoice_number?: string
          lines?: Json
          note?: string | null
          payment_id?: string | null
          rejection_reason?: string | null
          status?: string
          subtotal?: number
          ticket_id: string
          timesheet_id?: string | null
          total?: number
          updated_at?: string
          vat_amount?: number
          vat_percent?: number
        }
        Update: {
          client_id?: string
          consultant_id?: string
          created_at?: string
          currency?: string
          decided_at?: string | null
          id?: string
          invoice_number?: string
          lines?: Json
          note?: string | null
          payment_id?: string | null
          rejection_reason?: string | null
          status?: string
          subtotal?: number
          ticket_id?: string
          timesheet_id?: string | null
          total?: number
          updated_at?: string
          vat_amount?: number
          vat_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_invoices_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_invoices_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          link_type: string
          source_ticket_id: string
          target_ticket_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_type?: string
          source_ticket_id: string
          target_ticket_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          link_type?: string
          source_ticket_id?: string
          target_ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_links_source_ticket_id_fkey"
            columns: ["source_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_links_target_ticket_id_fkey"
            columns: ["target_ticket_id"]
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
      ticket_payment_terms: {
        Row: {
          consultant_id: string
          created_at: string
          decided_at: string | null
          decision_note: string | null
          deposit_percent: number
          id: string
          milestones: Json
          net_days: number
          status: string
          term_type: string
          ticket_id: string
          updated_at: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          deposit_percent?: number
          id?: string
          milestones?: Json
          net_days?: number
          status?: string
          term_type?: string
          ticket_id: string
          updated_at?: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          decided_at?: string | null
          decision_note?: string | null
          deposit_percent?: number
          id?: string
          milestones?: Json
          net_days?: number
          status?: string
          term_type?: string
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_payment_terms_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_payment_terms_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: true
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_rates: {
        Row: {
          consultant_id: string
          created_at: string
          currency: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          hourly_rate: number
          id: string
          proposed_by: string | null
          source: string
          status: string
          ticket_id: string
          updated_at: string
        }
        Insert: {
          consultant_id: string
          created_at?: string
          currency?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          hourly_rate: number
          id?: string
          proposed_by?: string | null
          source?: string
          status?: string
          ticket_id: string
          updated_at?: string
        }
        Update: {
          consultant_id?: string
          created_at?: string
          currency?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          hourly_rate?: number
          id?: string
          proposed_by?: string | null
          source?: string
          status?: string
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_rates_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_rates_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_satisfaction_surveys: {
        Row: {
          client_id: string
          consultant_id: string | null
          created_at: string
          feedback: string | null
          id: string
          rating: number | null
          responded_at: string | null
          sent_at: string | null
          ticket_id: string
        }
        Insert: {
          client_id: string
          consultant_id?: string | null
          created_at?: string
          feedback?: string | null
          id?: string
          rating?: number | null
          responded_at?: string | null
          sent_at?: string | null
          ticket_id: string
        }
        Update: {
          client_id?: string
          consultant_id?: string | null
          created_at?: string
          feedback?: string | null
          id?: string
          rating?: number | null
          responded_at?: string | null
          sent_at?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_satisfaction_surveys_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_sla_policies: {
        Row: {
          business_hours_only: boolean | null
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          resolution_time_minutes: number
          response_time_minutes: number
          sap_module: string | null
          updated_at: string
          urgency: string
        }
        Insert: {
          business_hours_only?: boolean | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          resolution_time_minutes?: number
          response_time_minutes?: number
          sap_module?: string | null
          updated_at?: string
          urgency?: string
        }
        Update: {
          business_hours_only?: boolean | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          resolution_time_minutes?: number
          response_time_minutes?: number
          sap_module?: string | null
          updated_at?: string
          urgency?: string
        }
        Relationships: []
      }
      ticket_tags: {
        Row: {
          added_by: string | null
          color: string | null
          created_at: string
          id: string
          tag: string
          ticket_id: string
        }
        Insert: {
          added_by?: string | null
          color?: string | null
          created_at?: string
          id?: string
          tag: string
          ticket_id: string
        }
        Update: {
          added_by?: string | null
          color?: string | null
          created_at?: string
          id?: string
          tag?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_tags_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_timesheet_comments: {
        Row: {
          author_id: string
          author_role: string
          body: string
          created_at: string
          id: string
          kind: string
          submission_id: string
        }
        Insert: {
          author_id: string
          author_role: string
          body: string
          created_at?: string
          id?: string
          kind?: string
          submission_id: string
        }
        Update: {
          author_id?: string
          author_role?: string
          body?: string
          created_at?: string
          id?: string
          kind?: string
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_timesheet_comments_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "ticket_timesheet_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_timesheet_submissions: {
        Row: {
          billable_hours: number
          cost_currency: string | null
          created_at: string
          grand_total: number | null
          hourly_rate: number | null
          id: string
          notes: string | null
          pdf_url: string | null
          processing_fee_amount: number | null
          processing_fee_percent: number | null
          sent_to_email: string | null
          service_fee_amount: number | null
          service_fee_percent: number | null
          signature_data: string | null
          signature_method: string | null
          signed_at: string | null
          signed_by_name: string | null
          status: string
          submit_count: number
          submitted_at: string | null
          submitted_by: string
          ticket_id: string
          total_cost: number | null
          total_hours: number | null
          updated_at: string
          vat_amount: number | null
          vat_percent: number | null
        }
        Insert: {
          billable_hours?: number
          cost_currency?: string | null
          created_at?: string
          grand_total?: number | null
          hourly_rate?: number | null
          id?: string
          notes?: string | null
          pdf_url?: string | null
          processing_fee_amount?: number | null
          processing_fee_percent?: number | null
          sent_to_email?: string | null
          service_fee_amount?: number | null
          service_fee_percent?: number | null
          signature_data?: string | null
          signature_method?: string | null
          signed_at?: string | null
          signed_by_name?: string | null
          status?: string
          submit_count?: number
          submitted_at?: string | null
          submitted_by: string
          ticket_id: string
          total_cost?: number | null
          total_hours?: number | null
          updated_at?: string
          vat_amount?: number | null
          vat_percent?: number | null
        }
        Update: {
          billable_hours?: number
          cost_currency?: string | null
          created_at?: string
          grand_total?: number | null
          hourly_rate?: number | null
          id?: string
          notes?: string | null
          pdf_url?: string | null
          processing_fee_amount?: number | null
          processing_fee_percent?: number | null
          sent_to_email?: string | null
          service_fee_amount?: number | null
          service_fee_percent?: number | null
          signature_data?: string | null
          signature_method?: string | null
          signed_at?: string | null
          signed_by_name?: string | null
          status?: string
          submit_count?: number
          submitted_at?: string | null
          submitted_by?: string
          ticket_id?: string
          total_cost?: number | null
          total_hours?: number | null
          updated_at?: string
          vat_amount?: number | null
          vat_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_timesheet_submissions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_watchers: {
        Row: {
          created_at: string
          id: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ticket_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_watchers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_work_logs: {
        Row: {
          billable: boolean
          category: string
          consultant_id: string
          created_at: string
          description: string | null
          hourly_rate: number | null
          hours: number
          id: string
          submission_id: string | null
          ticket_id: string
          total_cost: number | null
          updated_at: string
          work_date: string
        }
        Insert: {
          billable?: boolean
          category?: string
          consultant_id: string
          created_at?: string
          description?: string | null
          hourly_rate?: number | null
          hours?: number
          id?: string
          submission_id?: string | null
          ticket_id: string
          total_cost?: number | null
          updated_at?: string
          work_date?: string
        }
        Update: {
          billable?: boolean
          category?: string
          consultant_id?: string
          created_at?: string
          description?: string | null
          hourly_rate?: number | null
          hours?: number
          id?: string
          submission_id?: string | null
          ticket_id?: string
          total_cost?: number | null
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_work_logs_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_work_logs_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "ticket_timesheet_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_work_logs_ticket_id_fkey"
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
          area_details: string | null
          client_id: string
          consultant_id: string | null
          cost_breakdown: Json | null
          cost_currency: string | null
          created_at: string
          description: string | null
          editing_by: string | null
          editing_since: string | null
          first_response_at: string | null
          id: string
          merged_into_ticket_id: string | null
          open_for_bids: boolean
          opened_for_bids_at: string | null
          parent_ticket_id: string | null
          plan_approved_at: string | null
          plan_approved_by: string | null
          plan_rejected_at: string | null
          plan_rejection_reason: string | null
          plan_submitted_at: string | null
          planned_cost: number | null
          planned_hours: number | null
          preferred_language: string | null
          preferred_session_type:
            | Database["public"]["Enums"]["session_type"]
            | null
          resolution_notes: string | null
          resolved_at: string | null
          sap_module: string
          sap_module_other: string | null
          sap_modules: string[]
          sap_notes_tried: string[]
          sla_breached: boolean | null
          sla_deadline: string | null
          sla_policy_id: string | null
          sla_response_deadline: string | null
          status: Database["public"]["Enums"]["ticket_status"] | null
          tenant_id: string | null
          ticket_type: string
          title: string
          updated_at: string
          urgency: Database["public"]["Enums"]["urgency_level"] | null
        }
        Insert: {
          ai_suggested_category?: string | null
          ai_suggested_priority?: string | null
          area_details?: string | null
          client_id: string
          consultant_id?: string | null
          cost_breakdown?: Json | null
          cost_currency?: string | null
          created_at?: string
          description?: string | null
          editing_by?: string | null
          editing_since?: string | null
          first_response_at?: string | null
          id?: string
          merged_into_ticket_id?: string | null
          open_for_bids?: boolean
          opened_for_bids_at?: string | null
          parent_ticket_id?: string | null
          plan_approved_at?: string | null
          plan_approved_by?: string | null
          plan_rejected_at?: string | null
          plan_rejection_reason?: string | null
          plan_submitted_at?: string | null
          planned_cost?: number | null
          planned_hours?: number | null
          preferred_language?: string | null
          preferred_session_type?:
            | Database["public"]["Enums"]["session_type"]
            | null
          resolution_notes?: string | null
          resolved_at?: string | null
          sap_module: string
          sap_module_other?: string | null
          sap_modules?: string[]
          sap_notes_tried?: string[]
          sla_breached?: boolean | null
          sla_deadline?: string | null
          sla_policy_id?: string | null
          sla_response_deadline?: string | null
          status?: Database["public"]["Enums"]["ticket_status"] | null
          tenant_id?: string | null
          ticket_type?: string
          title: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"] | null
        }
        Update: {
          ai_suggested_category?: string | null
          ai_suggested_priority?: string | null
          area_details?: string | null
          client_id?: string
          consultant_id?: string | null
          cost_breakdown?: Json | null
          cost_currency?: string | null
          created_at?: string
          description?: string | null
          editing_by?: string | null
          editing_since?: string | null
          first_response_at?: string | null
          id?: string
          merged_into_ticket_id?: string | null
          open_for_bids?: boolean
          opened_for_bids_at?: string | null
          parent_ticket_id?: string | null
          plan_approved_at?: string | null
          plan_approved_by?: string | null
          plan_rejected_at?: string | null
          plan_rejection_reason?: string | null
          plan_submitted_at?: string | null
          planned_cost?: number | null
          planned_hours?: number | null
          preferred_language?: string | null
          preferred_session_type?:
            | Database["public"]["Enums"]["session_type"]
            | null
          resolution_notes?: string | null
          resolved_at?: string | null
          sap_module?: string
          sap_module_other?: string | null
          sap_modules?: string[]
          sap_notes_tried?: string[]
          sla_breached?: boolean | null
          sla_deadline?: string | null
          sla_policy_id?: string | null
          sla_response_deadline?: string | null
          status?: Database["public"]["Enums"]["ticket_status"] | null
          tenant_id?: string | null
          ticket_type?: string
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
          {
            foreignKeyName: "tickets_merged_into_ticket_id_fkey"
            columns: ["merged_into_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_parent_ticket_id_fkey"
            columns: ["parent_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_sla_policy_id_fkey"
            columns: ["sla_policy_id"]
            isOneToOne: false
            referencedRelation: "ticket_sla_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      user_screen_preferences: {
        Row: {
          created_at: string
          id: string
          is_visible: boolean
          screen_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_visible?: boolean
          screen_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_visible?: boolean
          screen_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vmware_pricing_plans: {
        Row: {
          cpu_price_per_core: number | null
          created_at: string
          description: string | null
          disk_price_per_gb: number | null
          external_url: string | null
          features: Json | null
          hourly_rate: number | null
          id: string
          included_cpu: number | null
          included_disk_gb: number | null
          included_ram_gb: number | null
          is_active: boolean | null
          monthly_rate: number | null
          name: string
          provider_name: string | null
          ram_price_per_gb: number | null
          sort_order: number | null
          tier: string
          updated_at: string
        }
        Insert: {
          cpu_price_per_core?: number | null
          created_at?: string
          description?: string | null
          disk_price_per_gb?: number | null
          external_url?: string | null
          features?: Json | null
          hourly_rate?: number | null
          id?: string
          included_cpu?: number | null
          included_disk_gb?: number | null
          included_ram_gb?: number | null
          is_active?: boolean | null
          monthly_rate?: number | null
          name: string
          provider_name?: string | null
          ram_price_per_gb?: number | null
          sort_order?: number | null
          tier?: string
          updated_at?: string
        }
        Update: {
          cpu_price_per_core?: number | null
          created_at?: string
          description?: string | null
          disk_price_per_gb?: number | null
          external_url?: string | null
          features?: Json | null
          hourly_rate?: number | null
          id?: string
          included_cpu?: number | null
          included_disk_gb?: number | null
          included_ram_gb?: number | null
          is_active?: boolean | null
          monthly_rate?: number | null
          name?: string
          provider_name?: string | null
          ram_price_per_gb?: number | null
          sort_order?: number | null
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      vmware_settings: {
        Row: {
          allowed_ports: string[] | null
          auto_shutdown_hours: number | null
          availability_zone: string | null
          cloud_account_id: string | null
          cloud_api_endpoint: string | null
          cloud_api_key_ciphertext: string | null
          cloud_api_key_encrypted: string | null
          cloud_project_id: string | null
          cloud_region: string | null
          cloud_vendor: string
          cluster: string | null
          created_at: string
          datacenter: string | null
          datastore: string | null
          default_cpu: number | null
          default_disk_gb: number | null
          default_os_template: string | null
          default_ram_gb: number | null
          environment_id: string
          firewall_rules: Json | null
          hypervisor_type: string
          id: string
          instance_type: string | null
          network_vlan: string | null
          notes: string | null
          resource_pool: string | null
          security_group: string | null
          snapshot_enabled: boolean | null
          storage_type: string | null
          subnet_id: string | null
          updated_at: string
          vcenter_password_ciphertext: string | null
          vcenter_password_encrypted: string | null
          vcenter_url: string | null
          vcenter_username: string | null
          vpn_gateway: string | null
          vpn_type: string | null
        }
        Insert: {
          allowed_ports?: string[] | null
          auto_shutdown_hours?: number | null
          availability_zone?: string | null
          cloud_account_id?: string | null
          cloud_api_endpoint?: string | null
          cloud_api_key_ciphertext?: string | null
          cloud_api_key_encrypted?: string | null
          cloud_project_id?: string | null
          cloud_region?: string | null
          cloud_vendor?: string
          cluster?: string | null
          created_at?: string
          datacenter?: string | null
          datastore?: string | null
          default_cpu?: number | null
          default_disk_gb?: number | null
          default_os_template?: string | null
          default_ram_gb?: number | null
          environment_id: string
          firewall_rules?: Json | null
          hypervisor_type?: string
          id?: string
          instance_type?: string | null
          network_vlan?: string | null
          notes?: string | null
          resource_pool?: string | null
          security_group?: string | null
          snapshot_enabled?: boolean | null
          storage_type?: string | null
          subnet_id?: string | null
          updated_at?: string
          vcenter_password_ciphertext?: string | null
          vcenter_password_encrypted?: string | null
          vcenter_url?: string | null
          vcenter_username?: string | null
          vpn_gateway?: string | null
          vpn_type?: string | null
        }
        Update: {
          allowed_ports?: string[] | null
          auto_shutdown_hours?: number | null
          availability_zone?: string | null
          cloud_account_id?: string | null
          cloud_api_endpoint?: string | null
          cloud_api_key_ciphertext?: string | null
          cloud_api_key_encrypted?: string | null
          cloud_project_id?: string | null
          cloud_region?: string | null
          cloud_vendor?: string
          cluster?: string | null
          created_at?: string
          datacenter?: string | null
          datastore?: string | null
          default_cpu?: number | null
          default_disk_gb?: number | null
          default_os_template?: string | null
          default_ram_gb?: number | null
          environment_id?: string
          firewall_rules?: Json | null
          hypervisor_type?: string
          id?: string
          instance_type?: string | null
          network_vlan?: string | null
          notes?: string | null
          resource_pool?: string | null
          security_group?: string | null
          snapshot_enabled?: boolean | null
          storage_type?: string | null
          subnet_id?: string | null
          updated_at?: string
          vcenter_password_ciphertext?: string | null
          vcenter_password_encrypted?: string | null
          vcenter_url?: string | null
          vcenter_username?: string | null
          vpn_gateway?: string | null
          vpn_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vmware_settings_environment_id_fkey"
            columns: ["environment_id"]
            isOneToOne: true
            referencedRelation: "remote_environments"
            referencedColumns: ["id"]
          },
        ]
      }
      vmware_snapshots: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          environment_id: string
          id: string
          name: string
          size_gb: number | null
          status: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          environment_id: string
          id?: string
          name: string
          size_gb?: number | null
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          environment_id?: string
          id?: string
          name?: string
          size_gb?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vmware_snapshots_environment_id_fkey"
            columns: ["environment_id"]
            isOneToOne: false
            referencedRelation: "remote_environments"
            referencedColumns: ["id"]
          },
        ]
      }
      vmware_subscriptions: {
        Row: {
          billing_cycle: string
          cancelled_at: string | null
          client_id: string
          created_at: string
          current_monthly_cost: number | null
          environment_id: string | null
          expires_at: string | null
          id: string
          plan_id: string
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          billing_cycle?: string
          cancelled_at?: string | null
          client_id: string
          created_at?: string
          current_monthly_cost?: number | null
          environment_id?: string | null
          expires_at?: string | null
          id?: string
          plan_id: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          billing_cycle?: string
          cancelled_at?: string | null
          client_id?: string
          created_at?: string
          current_monthly_cost?: number | null
          environment_id?: string | null
          expires_at?: string | null
          id?: string
          plan_id?: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vmware_subscriptions_environment_id_fkey"
            columns: ["environment_id"]
            isOneToOne: false
            referencedRelation: "remote_environments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vmware_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "vmware_pricing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      vmware_vm_actions: {
        Row: {
          action: string
          completed_at: string | null
          created_at: string
          environment_id: string
          error_message: string | null
          id: string
          initiated_by: string
          status: string
        }
        Insert: {
          action: string
          completed_at?: string | null
          created_at?: string
          environment_id: string
          error_message?: string | null
          id?: string
          initiated_by: string
          status?: string
        }
        Update: {
          action?: string
          completed_at?: string | null
          created_at?: string
          environment_id?: string
          error_message?: string | null
          id?: string
          initiated_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "vmware_vm_actions_environment_id_fkey"
            columns: ["environment_id"]
            isOneToOne: false
            referencedRelation: "remote_environments"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          code: string
          created_at: string
          discount_type: string
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          plan_id: string | null
          updated_at: string
          used_count: number
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          discount_type: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          plan_id?: string | null
          updated_at?: string
          used_count?: number
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          discount_type?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          plan_id?: string | null
          updated_at?: string
          used_count?: number
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      work_diary_entries: {
        Row: {
          activity_level: number | null
          consultant_id: string
          created_at: string
          end_time: string | null
          id: string
          is_manual: boolean | null
          memo: string | null
          screenshot_url: string | null
          session_id: string | null
          start_time: string
          updated_at: string
        }
        Insert: {
          activity_level?: number | null
          consultant_id: string
          created_at?: string
          end_time?: string | null
          id?: string
          is_manual?: boolean | null
          memo?: string | null
          screenshot_url?: string | null
          session_id?: string | null
          start_time: string
          updated_at?: string
        }
        Update: {
          activity_level?: number | null
          consultant_id?: string
          created_at?: string
          end_time?: string | null
          id?: string
          is_manual?: boolean | null
          memo?: string | null
          screenshot_url?: string | null
          session_id?: string | null
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_diary_entries_consultant_id_fkey"
            columns: ["consultant_id"]
            isOneToOne: false
            referencedRelation: "consultants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_diary_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
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
      consultant_reviews: {
        Row: {
          client_id: string | null
          comment: string | null
          communication_score: number | null
          consultant_id: string | null
          created_at: string | null
          id: string | null
          is_anonymous: boolean | null
          responsiveness_score: number | null
          score: number | null
          session_id: string | null
          technical_expertise_score: number | null
        }
        Insert: {
          client_id?: never
          comment?: string | null
          communication_score?: number | null
          consultant_id?: string | null
          created_at?: string | null
          id?: string | null
          is_anonymous?: boolean | null
          responsiveness_score?: number | null
          score?: number | null
          session_id?: string | null
          technical_expertise_score?: number | null
        }
        Update: {
          client_id?: never
          comment?: string | null
          communication_score?: number | null
          consultant_id?: string | null
          created_at?: string | null
          id?: string | null
          is_anonymous?: boolean | null
          responsiveness_score?: number | null
          score?: number | null
          session_id?: string | null
          technical_expertise_score?: number | null
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
      environment_credentials_safe: {
        Row: {
          created_at: string | null
          credential_label: string | null
          domain: string | null
          entered_by: string | null
          environment_id: string | null
          hostname: string | null
          id: string | null
          port: number | null
          updated_at: string | null
          username: string | null
        }
        Insert: {
          created_at?: string | null
          credential_label?: string | null
          domain?: string | null
          entered_by?: string | null
          environment_id?: string | null
          hostname?: string | null
          id?: string | null
          port?: number | null
          updated_at?: string | null
          username?: string | null
        }
        Update: {
          created_at?: string | null
          credential_label?: string | null
          domain?: string | null
          entered_by?: string | null
          environment_id?: string | null
          hostname?: string | null
          id?: string | null
          port?: number | null
          updated_at?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "environment_credentials_environment_id_fkey"
            columns: ["environment_id"]
            isOneToOne: false
            referencedRelation: "remote_environments"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations_safe: {
        Row: {
          client_id: string | null
          created_at: string | null
          external_project_id: string | null
          id: string | null
          last_synced_at: string | null
          platform: Database["public"]["Enums"]["integration_platform"] | null
          platform_url: string | null
          settings: Json | null
          status: Database["public"]["Enums"]["integration_status"] | null
          sync_enabled: boolean | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          external_project_id?: string | null
          id?: string | null
          last_synced_at?: string | null
          platform?: Database["public"]["Enums"]["integration_platform"] | null
          platform_url?: string | null
          settings?: Json | null
          status?: Database["public"]["Enums"]["integration_status"] | null
          sync_enabled?: boolean | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          external_project_id?: string | null
          id?: string | null
          last_synced_at?: string | null
          platform?: Database["public"]["Enums"]["integration_platform"] | null
          platform_url?: string | null
          settings?: Json | null
          status?: Database["public"]["Enums"]["integration_status"] | null
          sync_enabled?: boolean | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_directory: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          display_name?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          display_name?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      vmware_settings_safe: {
        Row: {
          auto_shutdown_hours: number | null
          availability_zone: string | null
          cloud_api_endpoint: string | null
          cloud_region: string | null
          cloud_vendor: string | null
          cluster: string | null
          created_at: string | null
          datacenter: string | null
          datastore: string | null
          default_cpu: number | null
          default_disk_gb: number | null
          default_os_template: string | null
          default_ram_gb: number | null
          environment_id: string | null
          hypervisor_type: string | null
          id: string | null
          instance_type: string | null
          network_vlan: string | null
          notes: string | null
          resource_pool: string | null
          security_group: string | null
          snapshot_enabled: boolean | null
          storage_type: string | null
          subnet_id: string | null
          updated_at: string | null
          vcenter_url: string | null
          vcenter_username: string | null
        }
        Insert: {
          auto_shutdown_hours?: number | null
          availability_zone?: string | null
          cloud_api_endpoint?: string | null
          cloud_region?: string | null
          cloud_vendor?: string | null
          cluster?: string | null
          created_at?: string | null
          datacenter?: string | null
          datastore?: string | null
          default_cpu?: number | null
          default_disk_gb?: number | null
          default_os_template?: string | null
          default_ram_gb?: number | null
          environment_id?: string | null
          hypervisor_type?: string | null
          id?: string | null
          instance_type?: string | null
          network_vlan?: string | null
          notes?: string | null
          resource_pool?: string | null
          security_group?: string | null
          snapshot_enabled?: boolean | null
          storage_type?: string | null
          subnet_id?: string | null
          updated_at?: string | null
          vcenter_url?: string | null
          vcenter_username?: string | null
        }
        Update: {
          auto_shutdown_hours?: number | null
          availability_zone?: string | null
          cloud_api_endpoint?: string | null
          cloud_region?: string | null
          cloud_vendor?: string | null
          cluster?: string | null
          created_at?: string | null
          datacenter?: string | null
          datastore?: string | null
          default_cpu?: number | null
          default_disk_gb?: number | null
          default_os_template?: string | null
          default_ram_gb?: number | null
          environment_id?: string | null
          hypervisor_type?: string | null
          id?: string | null
          instance_type?: string | null
          network_vlan?: string | null
          notes?: string | null
          resource_pool?: string | null
          security_group?: string | null
          snapshot_enabled?: boolean | null
          storage_type?: string | null
          subnet_id?: string | null
          updated_at?: string | null
          vcenter_url?: string | null
          vcenter_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vmware_settings_environment_id_fkey"
            columns: ["environment_id"]
            isOneToOne: true
            referencedRelation: "remote_environments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_proposal: {
        Args: { _client_notes?: string; _proposal_id: string }
        Returns: undefined
      }
      add_timesheet_comment: {
        Args: { _body: string; _submission_id: string }
        Returns: string
      }
      admin_client_approval_counts: { Args: never; Returns: Json }
      admin_confirm_payment: {
        Args: {
          _bank_reference: string
          _note?: string
          _payment_id: string
          _received_amount?: number
        }
        Returns: undefined
      }
      admin_confirm_reschedule_slot: {
        Args: { _note?: string; _request_id: string; _slot_index?: number }
        Returns: {
          company: string | null
          created_at: string
          demo_type: string
          email: string
          full_name: string
          id: string
          meeting_format: string | null
          notes: string | null
          proposed_slots: Json | null
          request_token: string
          reschedule_reason: string | null
          reschedule_requested_at: string | null
          scheduled_date: string | null
          scheduled_slot: string | null
          scheduling_preference: string
          source: string | null
          status: string
          status_note: string | null
          timezone: string | null
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "demo_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_create_invoice: {
        Args: {
          _amount: number
          _client_id: string
          _consultant_id: string
          _currency: string
          _description: string
          _due_days?: number
          _ticket_id: string
          _vat_amount?: number
        }
        Returns: string
      }
      admin_list_client_approvals: {
        Args: { p_limit?: number; p_status?: string }
        Returns: Json
      }
      admin_reject_payment_report: {
        Args: { _note: string; _payment_id: string }
        Returns: undefined
      }
      admin_review_client: {
        Args: { p_comment?: string; p_decision: string; p_user_id: string }
        Returns: undefined
      }
      admin_rls_overview: { Args: never; Returns: Json }
      admin_set_payout_status: {
        Args: {
          _bank_reference?: string
          _note?: string
          _payout_id: string
          _status: string
        }
        Returns: undefined
      }
      admin_storage_overview: { Args: never; Returns: Json }
      apply_provider_payment: {
        Args: {
          _amount: number
          _currency: string
          _kind: string
          _order_id: string
          _payload?: Json
          _provider: string
          _source?: string
          _transaction_id: string
        }
        Returns: string
      }
      assert_demo_slot_not_past: {
        Args: { _date: string; _slot: string; _timezone: string }
        Returns: undefined
      }
      audit_changed: { Args: { _new: Json; _old: Json }; Returns: Json }
      audit_is_sensitive_key: { Args: { _k: string }; Returns: boolean }
      audit_scrub_row: { Args: { _row: Json }; Returns: Json }
      bp_matches_ticket_client: {
        Args: { _bp_id: string; _ticket_id: string }
        Returns: boolean
      }
      can_bootstrap_tenant_membership: {
        Args: { _tenant_id: string }
        Returns: boolean
      }
      can_use_internal_notes: { Args: { _ticket_id: string }; Returns: boolean }
      card_payment_context: {
        Args: { _payment_id: string; _user_id: string }
        Returns: Json
      }
      card_payments_enabled: { Args: never; Returns: boolean }
      check_rate_limit: {
        Args: { _bucket: string; _limit: number; _window_seconds: number }
        Returns: boolean
      }
      client_approval_required: { Args: never; Returns: boolean }
      client_info_ready: {
        Args: { _company_name: string; _sap_modules: string[] }
        Returns: boolean
      }
      client_report_payment: {
        Args: {
          _note?: string
          _payment_id: string
          _transfer_date: string
          _transfer_reference: string
        }
        Returns: undefined
      }
      client_resubmit_for_approval: {
        Args: { p_message?: string }
        Returns: undefined
      }
      client_sign_nda: {
        Args: {
          _nda_id: string
          _signature: string
          _signature_type: string
          _signer_name: string
        }
        Returns: undefined
      }
      client_subscribe_plan: {
        Args: { _plan_id: string; _tickets: number; _voucher_code?: string }
        Returns: string
      }
      complete_live_interview: {
        Args: {
          _overall: number
          _session_id: string
          _soft: number
          _summary: string
          _technical: number
        }
        Returns: undefined
      }
      consultant_booked_times: {
        Args: { _consultant_id: string; _from: string; _to: string }
        Returns: {
          duration_minutes: number
          scheduled_at: string
        }[]
      }
      consultant_has_environment_for_client: {
        Args: { _client_id: string; _consultant_id: string }
        Returns: boolean
      }
      consultant_has_ticket_link: {
        Args: { _ticket_id: string }
        Returns: boolean
      }
      consultant_profile_visible: {
        Args: { _consultant_id: string }
        Returns: boolean
      }
      consultant_related_to_client: {
        Args: {
          _client_id: string
          _consultant_id: string
          _include_bids?: boolean
        }
        Returns: boolean
      }
      consultant_set_ticket_status: {
        Args: { _resolution?: string; _status: string; _ticket_id: string }
        Returns: undefined
      }
      consultants_solved_similar: {
        Args: {
          _areas: string[]
          _limit?: number
          _query: string
          _tenant: string
        }
        Returns: {
          consultant_id: string
          resolved_in_areas: number
          solved_similar: number
        }[]
      }
      consume_remote_share_quota: { Args: never; Returns: boolean }
      get_demo_request_by_token: {
        Args: { _token: string }
        Returns: {
          company: string
          created_at: string
          demo_type: string
          email: string
          full_name: string
          id: string
          meeting_format: string
          notes: string
          proposed_slots: Json
          reschedule_reason: string
          reschedule_requested_at: string
          scheduled_date: string
          scheduled_slot: string
          scheduling_preference: string
          status: string
          status_note: string
          timezone: string
          updated_at: string
        }[]
      }
      get_emergency_contact: {
        Args: { _ticket_id: string }
        Returns: {
          display_name: string
          hourly_rate: number
          phone: string
        }[]
      }
      get_integration_credentials: {
        Args: { _integration_id: string }
        Returns: {
          api_key_encrypted: string
          webhook_secret: string
        }[]
      }
      get_payment_instructions: { Args: never; Returns: Json }
      get_user_tenant_id: { Args: never; Returns: string }
      get_vmware_settings_safe: {
        Args: { p_environment_id: string }
        Returns: {
          auto_shutdown_hours: number
          cloud_vendor: string
          cluster: string
          created_at: string
          datacenter: string
          datastore: string
          default_cpu: number
          default_disk_gb: number
          default_os_template: string
          default_ram_gb: number
          environment_id: string
          hypervisor_type: string
          id: string
          network_vlan: string
          notes: string
          resource_pool: string
          snapshot_enabled: boolean
          updated_at: string
          vcenter_url: string
          vcenter_username: string
        }[]
      }
      grant_referral_rewards: { Args: { _user_id: string }; Returns: undefined }
      has_active_nda: {
        Args: { _client_id: string; _consultant_id: string }
        Returns: boolean
      }
      has_org_role: {
        Args: {
          _role: Database["public"]["Enums"]["org_role"]
          _tenant_id: string
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      interview_role: {
        Args: { _session_id: string; _user_id: string }
        Returns: string
      }
      invite_to_company: {
        Args: {
          _email: string
          _role?: Database["public"]["Enums"]["org_role"]
          _tenant_id: string
        }
        Returns: undefined
      }
      invite_to_meeting: {
        Args: { _consultant_ids: string[]; _session_id: string }
        Returns: number
      }
      is_sap_note_list: { Args: { _v: string[] }; Returns: boolean }
      is_session_participant: {
        Args: { _session_id: string }
        Returns: boolean
      }
      is_tenant_member: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      is_ticket_participant: { Args: { _ticket_id: string }; Returns: boolean }
      is_untrusted_writer: { Args: never; Returns: boolean }
      knowledge_terms: { Args: { _query: string }; Returns: string[] }
      knowledge_tsquery: { Args: { _query: string }; Returns: unknown }
      log_client_event: {
        Args: {
          _action: string
          _entity_id?: string
          _entity_type?: string
          _metadata?: Json
        }
        Returns: undefined
      }
      my_client_approval: { Args: never; Returns: Json }
      my_company_invitations: {
        Args: never
        Returns: {
          company_name: string
          invited_at: string
          invited_by: string
          org_role: Database["public"]["Enums"]["org_role"]
          tenant_id: string
        }[]
      }
      my_consultant_env_access: {
        Args: { _connectable?: boolean; _env: string }
        Returns: boolean
      }
      my_nda_pending_access: {
        Args: never
        Returns: {
          client_id: string
          client_name: string
          detail: string
          kind: string
          ref_id: string
          since: string
        }[]
      }
      normalize_credly_username: { Args: { _v: string }; Returns: string }
      normalize_linkedin_url: { Args: { _v: string }; Returns: string }
      notify_payment_admins: {
        Args: { _body: string; _title: string }
        Returns: undefined
      }
      notify_unread_once: {
        Args: {
          _body: string
          _link: string
          _title: string
          _type: string
          _user_id: string
        }
        Returns: undefined
      }
      payment_commission_percent: { Args: never; Returns: number }
      payment_processing_fee_percent: { Args: never; Returns: number }
      payment_service_fee_percent: { Args: never; Returns: number }
      payment_vat_percent: { Args: never; Returns: number }
      plan_limits_enforced: { Args: never; Returns: boolean }
      pricing_breakdown: { Args: { _base: number }; Returns: Json }
      pricing_terms: { Args: never; Returns: Json }
      propose_ticket_rate: {
        Args: { _hourly_rate: number; _ticket_id: string }
        Returns: string
      }
      quote_plan_price: {
        Args: { _plan_id: string; _tickets: number; _voucher_code?: string }
        Returns: Json
      }
      recompute_consultant_rating: {
        Args: { _consultant_id: string }
        Returns: undefined
      }
      register_card_attempt: {
        Args: {
          _intention_id?: string
          _order_id: string
          _payment_id: string
          _provider: string
        }
        Returns: undefined
      }
      registration_is_open: { Args: never; Returns: boolean }
      request_demo_reschedule: {
        Args: { _proposed_slots: Json; _reason?: string; _token: string }
        Returns: {
          company: string | null
          created_at: string
          demo_type: string
          email: string
          full_name: string
          id: string
          meeting_format: string | null
          notes: string | null
          proposed_slots: Json | null
          request_token: string
          reschedule_reason: string | null
          reschedule_requested_at: string | null
          scheduled_date: string | null
          scheduled_slot: string | null
          scheduling_preference: string
          source: string | null
          status: string
          status_note: string | null
          timezone: string | null
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "demo_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_vmware_plan: {
        Args: { p_billing_cycle?: string; p_plan_id: string }
        Returns: string
      }
      respond_ticket_invoice: {
        Args: { _approve: boolean; _invoice_id: string; _reason: string }
        Returns: string
      }
      respond_ticket_payment_terms: {
        Args: { _accept: boolean; _note: string; _ticket_id: string }
        Returns: undefined
      }
      respond_to_company_invitation: {
        Args: { _accept: boolean; _tenant_id: string }
        Returns: undefined
      }
      respond_to_ticket_rate: {
        Args: { _approve: boolean; _note?: string; _rate_id: string }
        Returns: undefined
      }
      respond_to_timesheet: {
        Args: { _approve: boolean; _note?: string; _submission_id: string }
        Returns: undefined
      }
      retry_failed_notification: {
        Args: { _id: string }
        Returns: {
          body: string | null
          created_at: string
          delivery_error: string | null
          delivery_status: string
          id: string
          is_read: boolean | null
          last_attempt_at: string
          link: string | null
          retry_count: number
          tenant_id: string | null
          title: string
          type: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      safe_insert_notification: {
        Args: {
          _body: string
          _link: string
          _title: string
          _type: string
          _user_id: string
        }
        Returns: string
      }
      search_knowledge: {
        Args: {
          _areas: string[]
          _limit?: number
          _query: string
          _tenant: string
        }
        Returns: {
          id: string
          kind: string
          problem: string
          rank: number
          sap_module: string
          solution: string
          tags: string[]
          title: string
        }[]
      }
      search_sap_docs: {
        Args: { _limit?: number; _terms: string[] }
        Returns: {
          body: string
          branch: string
          doc_title: string
          heading: string
          license: string
          path: string
          rank: number
          repo: string
          source_id: string
          source_title: string
        }[]
      }
      send_emergency_alert: { Args: { _ticket_id: string }; Returns: boolean }
      send_ticket_invoice: {
        Args: {
          _currency: string
          _lines: Json
          _note: string
          _ticket_id: string
          _timesheet_id: string
          _vat_percent: number
        }
        Returns: string
      }
      set_environment_consultants: {
        Args: { _consultant_ids: string[]; _environment_id: string }
        Returns: undefined
      }
      set_ticket_payment_terms: {
        Args: {
          _deposit_percent: number
          _milestones: Json
          _net_days: number
          _term_type: string
          _ticket_id: string
        }
        Returns: string
      }
      share_a_company: {
        Args: { _user_a: string; _user_b: string }
        Returns: boolean
      }
      share_in_validity_period: { Args: { _config: Json }; Returns: boolean }
      submit_demo_request: {
        Args: {
          _company: string
          _demo_type: string
          _email: string
          _full_name: string
          _meeting_format: string
          _notes: string
          _scheduled_date: string
          _scheduled_slot: string
          _scheduling_preference: string
          _source?: string
          _timezone: string
        }
        Returns: string
      }
      submit_ticket_plan: {
        Args: {
          _breakdown?: Json
          _cost_currency?: string
          _planned_cost: number
          _planned_hours: number
          _ticket_id: string
        }
        Returns: boolean
      }
      submit_timesheet: {
        Args: { _message?: string; _ticket_id: string }
        Returns: string
      }
      ticket_consultant_for_me: {
        Args: { _ticket_id: string }
        Returns: string
      }
      ticket_consultant_id: { Args: { _ticket_id: string }; Returns: string }
      ticket_in_my_company: { Args: { _ticket_id: string }; Returns: boolean }
      ticket_owned_by: {
        Args: { _client_id: string; _ticket_id: string }
        Returns: boolean
      }
      timesheet_vat_percent: { Args: never; Returns: number }
      try_timestamptz: { Args: { _t: string }; Returns: string }
      ts_num: { Args: { _n: number }; Returns: string }
      users_share_engagement: {
        Args: { _user_a: string; _user_b: string }
        Returns: boolean
      }
      users_visible_to_each_other: {
        Args: { _a: string; _b: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "client" | "consultant" | "admin" | "super_admin"
      article_status: "draft" | "published" | "archived"
      assignment_role: "lead" | "support" | "observer"
      assignment_status: "active" | "completed" | "removed"
      assignment_work_mode: "collaborative" | "individual"
      availability_status: "available" | "busy" | "offline"
      environment_status:
        | "active"
        | "inactive"
        | "maintenance"
        | "hold"
        | "cancelled"
      escrow_status:
        | "unfunded"
        | "funded"
        | "in_progress"
        | "submitted"
        | "approved"
        | "released"
        | "disputed"
      guac_protocol: "rdp" | "ssh" | "vnc"
      integration_platform: "zendesk" | "freshdesk" | "jira" | "servicenow"
      integration_status: "active" | "inactive" | "error"
      interview_mode: "ai" | "physical" | "online"
      interview_status: "pending" | "in_progress" | "completed" | "reviewed"
      match_request_status: "pending" | "accepted" | "rejected" | "withdrawn"
      message_type: "text" | "file" | "voice_note" | "system"
      org_role: "owner" | "admin" | "manager" | "member"
      payment_status: "pending" | "completed" | "refunded" | "disputed"
      payout_status: "pending" | "processing" | "completed" | "failed"
      project_status:
        | "planning"
        | "active"
        | "on_hold"
        | "completed"
        | "cancelled"
      proposal_status: "pending" | "accepted" | "rejected" | "withdrawn"
      session_status: "scheduled" | "in_progress" | "completed" | "cancelled"
      session_type: "chat" | "video" | "screen_share"
      subscription_status:
        | "active"
        | "trialing"
        | "past_due"
        | "canceled"
        | "inactive"
      subscription_tier: "basic" | "professional" | "enterprise"
      sync_direction: "inbound" | "outbound"
      sync_status: "success" | "failed" | "pending" | "skipped"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status: "todo" | "in_progress" | "in_review" | "done"
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
        | "on_hold"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["client", "consultant", "admin", "super_admin"],
      article_status: ["draft", "published", "archived"],
      assignment_role: ["lead", "support", "observer"],
      assignment_status: ["active", "completed", "removed"],
      assignment_work_mode: ["collaborative", "individual"],
      availability_status: ["available", "busy", "offline"],
      environment_status: [
        "active",
        "inactive",
        "maintenance",
        "hold",
        "cancelled",
      ],
      escrow_status: [
        "unfunded",
        "funded",
        "in_progress",
        "submitted",
        "approved",
        "released",
        "disputed",
      ],
      guac_protocol: ["rdp", "ssh", "vnc"],
      integration_platform: ["zendesk", "freshdesk", "jira", "servicenow"],
      integration_status: ["active", "inactive", "error"],
      interview_mode: ["ai", "physical", "online"],
      interview_status: ["pending", "in_progress", "completed", "reviewed"],
      match_request_status: ["pending", "accepted", "rejected", "withdrawn"],
      message_type: ["text", "file", "voice_note", "system"],
      org_role: ["owner", "admin", "manager", "member"],
      payment_status: ["pending", "completed", "refunded", "disputed"],
      payout_status: ["pending", "processing", "completed", "failed"],
      project_status: [
        "planning",
        "active",
        "on_hold",
        "completed",
        "cancelled",
      ],
      proposal_status: ["pending", "accepted", "rejected", "withdrawn"],
      session_status: ["scheduled", "in_progress", "completed", "cancelled"],
      session_type: ["chat", "video", "screen_share"],
      subscription_status: [
        "active",
        "trialing",
        "past_due",
        "canceled",
        "inactive",
      ],
      subscription_tier: ["basic", "professional", "enterprise"],
      sync_direction: ["inbound", "outbound"],
      sync_status: ["success", "failed", "pending", "skipped"],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: ["todo", "in_progress", "in_review", "done"],
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
        "on_hold",
        "verified",
        "rejected",
        "suspended",
      ],
    },
  },
} as const
