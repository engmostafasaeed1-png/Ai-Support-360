import { supabase } from '@/integrations/supabase/client';

type AuditAction =
  | 'login' | 'logout' | 'login_failed' | 'login_preflight_failed' | 'resend_confirmation_email'
  | 'ticket_created' | 'ticket_viewed' | 'ticket_updated' | 'ticket_deleted'
  | 'nda_viewed' | 'nda_signed' | 'nda_revoked'
  | 'document_uploaded' | 'document_downloaded'
  | 'consultant_matched' | 'session_started' | 'session_ended'
  | 'payment_initiated' | 'profile_updated'
  | 'admin_user_modified' | 'admin_role_changed'
  | 'settings_changed' | 'integration_connected';

export async function logAudit(action: AuditAction, metadata?: Record<string, unknown>) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('audit_logs').insert({
      action,
      user_id: user?.id ?? null,
      entity_type: action.split('_')[0],
      metadata: {
        ...metadata,
        userAgent: navigator.userAgent.slice(0, 200),
        timestamp: new Date().toISOString(),
        path: window.location.pathname,
      },
    });
  } catch {
    // Audit logging must never break the main flow
  }
}
