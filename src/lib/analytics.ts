/**
 * Lightweight analytics for landing-page funnels.
 *
 * Fire-and-forget — never blocks UI, never throws, never logs to the
 * user. Each event also fans out to `window.dataLayer` so any future
 * GTM/GA/Posthog integration just hooks the same names.
 *
 * Sessions are anonymous and survive a tab close (sessionStorage), so a
 * single visitor's funnel from CTA click → wizard step → submit can be
 * stitched together later in SQL.
 */
import { supabase } from '@/integrations/supabase/client';

const SESSION_KEY = 'qs_analytics_session_id';

function getSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        (typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}

export type AnalyticsProps = Record<string, unknown>;

export function track(event: string, properties: AnalyticsProps = {}): void {
  // Browser dataLayer fan-out — runs first so even an offline insert is
  // captured by GTM if it's installed later.
  if (typeof window !== 'undefined') {
    const w = window as unknown as { dataLayer?: unknown[] };
    w.dataLayer = w.dataLayer ?? [];
    w.dataLayer.push({ event, ...properties });
  }

  // Persist to Supabase. We deliberately don't await — we don't want to
  // delay or fail the user interaction that produced the event.
  void (async () => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      await supabase.from('analytics_events').insert({
        event,
        session_id: getSessionId(),
        user_id: userRes.user?.id ?? null,
        path: typeof window !== 'undefined' ? window.location.pathname : null,
        properties: properties as never,
      });
    } catch (err) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[analytics] failed to record', event, err);
      }
    }
  })();
}

/** Convenience for the demo-request funnel — keeps event names canonical. */
export const demoFunnel = {
  ctaClick: (source: string, demoType?: string) =>
    track('demo_cta_click', { source, demo_type: demoType ?? null }),
  wizardOpen: (source: string, demoType?: string) =>
    track('demo_wizard_open', { source, demo_type: demoType ?? null }),
  wizardStepView: (stepIndex: number, stepName: string) =>
    track('demo_wizard_step_view', { step_index: stepIndex, step_name: stepName }),
  wizardStepComplete: (stepIndex: number, stepName: string, props: AnalyticsProps = {}) =>
    track('demo_wizard_step_complete', { step_index: stepIndex, step_name: stepName, ...props }),
  wizardBack: (fromStep: number) =>
    track('demo_wizard_back', { from_step: fromStep }),
  wizardAbandon: (atStep: number, stepName: string) =>
    track('demo_wizard_abandon', { at_step: atStep, step_name: stepName }),
  submitAttempt: (props: AnalyticsProps) =>
    track('demo_request_submit_attempt', props),
  submitSuccess: (props: AnalyticsProps) =>
    track('demo_request_submit_success', props),
  submitError: (message: string) =>
    track('demo_request_submit_error', { message }),
};
