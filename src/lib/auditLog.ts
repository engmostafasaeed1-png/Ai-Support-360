import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

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
    // The browser may not write audit rows directly: a database function records the event for the signed-in user
    // (events before sign-in, such as a failed login, cannot be recorded from the browser).
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.rpc('log_client_event', {
      _action: action,
      _entity_type: action.split('_')[0],
      _metadata: {
        ...metadata,
        userAgent: navigator.userAgent.slice(0, 200),
        timestamp: new Date().toISOString(),
        path: window.location.pathname,
      } as unknown as Json,
    });
  } catch {
    // Audit logging must never break the main flow
  }
}
